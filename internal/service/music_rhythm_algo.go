package service

import (
	"encoding/base64"
	"errors"
	"math"
	"slices"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/errs"
)

const (
	// RhythmAlgoVersion 节拍分析算法版本号：调整核心参数或模型时递增，前端按版本决定是否静默重算升级
	RhythmAlgoVersion = 1

	rhythmSampleRate     = 11025
	rhythmFFTSize        = 1024
	rhythmHopSize        = 128
	rhythmFluxGamma      = 10.0
	rhythmDPAlpha        = 100.0
	rhythmDPWindow       = 1.35
	rhythmTempoPriorS    = 0.5
	rhythmTempoPriorSig  = 0.7
	rhythmMinPeriodS     = 0.25
	rhythmMaxPeriodS     = 1.5
	rhythmCombHarmonics  = 4
	rhythmOnsetQuantCap  = 10.0
	rhythmMaxDurationMs  = 3_600_000.0
	rhythmMaxBeats       = 10_000
	rhythmMaxAutocorr    = 4096
	rhythmMaxOnsetBase64 = 512_000
	rhythmMaxOnsetBytes  = 350_000
)

var errRhythmAudioTooShort = errors.New("audio too short")

func isFiniteFloat(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

func roundFloat(v float64, decimals int) float64 {
	if !isFiniteFloat(v) {
		return 0
	}
	pow := math.Pow10(decimals)
	res := math.Round(v*pow) / pow
	if res == 0 {
		// 消除 -0
		return 0
	}
	return res
}

type fft1024 struct {
	rev [rhythmFFTSize]int
	cos [rhythmFFTSize / 2]float64
	sin [rhythmFFTSize / 2]float64
}

func newFFT1024() *fft1024 {
	f := &fft1024{}
	const bits = 10 // log2(1024)
	for i := range rhythmFFTSize {
		r := 0
		for b := range bits {
			r |= ((i >> b) & 1) << (bits - 1 - b)
		}
		f.rev[i] = r
	}
	for i := range rhythmFFTSize / 2 {
		angle := 2 * math.Pi * float64(i) / float64(rhythmFFTSize)
		f.cos[i] = math.Cos(angle)
		f.sin[i] = math.Sin(angle)
	}
	return f
}

func (f *fft1024) transform(re, im *[rhythmFFTSize]float64) {
	for i := range rhythmFFTSize {
		j := f.rev[i]
		if j > i {
			re[i], re[j] = re[j], re[i]
			im[i], im[j] = im[j], im[i]
		}
	}
	for size := 2; size <= rhythmFFTSize; size <<= 1 {
		half := size >> 1
		step := rhythmFFTSize / size
		for i := 0; i < rhythmFFTSize; i += size {
			k := 0
			for j := i; j < i+half; j++ {
				l := j + half
				tre := re[l]*f.cos[k] + im[l]*f.sin[k]
				tim := im[l]*f.cos[k] - re[l]*f.sin[k]
				re[l] = re[j] - tre
				im[l] = im[j] - tim
				re[j] += tre
				im[j] += tim
				k += step
			}
		}
	}
}

func rhythmMovingAverage(values []float32, half int) []float32 {
	n := len(values)
	prefix := make([]float64, n+1)
	for i := range n {
		prefix[i+1] = prefix[i] + float64(values[i])
	}
	out := make([]float32, n)
	for i := range n {
		a := max(0, i-half)
		b := min(n, i+half+1)
		out[i] = float32((prefix[b] - prefix[a]) / float64(b-a))
	}
	return out
}

func rhythmPercentile(values []float32, q float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := slices.Clone(values)
	slices.Sort(sorted)
	idx := min(len(sorted)-1, int(math.Floor(q*float64(len(sorted)))))
	if idx < 0 {
		idx = 0
	}
	return float64(sorted[idx])
}

func rhythmTrackBeats(onset []float32, period float64, frames int) []int {
	score := make([]float64, frames)
	back := make([]int, frames)
	for i := range back {
		back[i] = -1
	}
	longest := max(1, int(math.Round(period*rhythmDPWindow)))
	shortest := max(1, int(math.Round(period/rhythmDPWindow)))
	penalty := make([]float64, longest+1)
	for dt := shortest; dt <= longest; dt++ {
		logRatio := math.Log(float64(dt) / period)
		penalty[dt] = rhythmDPAlpha * logRatio * logRatio
	}
	for t := range frames {
		best := math.Inf(-1)
		arg := -1
		startTau := max(0, t-longest)
		endTau := t - shortest
		for tau := startTau; tau <= endTau; tau++ {
			s := score[tau] - penalty[t-tau]
			if s > best {
				best = s
				arg = tau
			}
		}
		score[t] = float64(onset[t]) + math.Max(0, best)
		if best > 0 {
			back[t] = arg
		}
	}
	end := frames - 1
	startTail := max(0, frames-int(math.Round(period)))
	for t := startTail; t < frames; t++ {
		if score[t] > score[end] {
			end = t
		}
	}
	var beatFrames []int
	for t := end; t >= 0; t = back[t] {
		beatFrames = append(beatFrames, t)
	}
	slices.Reverse(beatFrames)
	return beatFrames
}

func encodeRhythmOnset(onset []float32) (onsetMax float64, onsetData string) {
	if len(onset) == 0 {
		return 0, ""
	}
	maxVal := 0.0
	for _, v := range onset {
		fv := float64(v)
		if fv > maxVal {
			maxVal = fv
		}
	}
	onsetMax = roundFloat(math.Min(maxVal, rhythmOnsetQuantCap), 4)
	if onsetMax <= 0 {
		return 0, ""
	}
	quantized := make([]byte, len(onset))
	invMax := 255.0 / onsetMax
	for i, v := range onset {
		q := math.Round(clamp01(float64(v)*invMax/255.0) * 255.0)
		quantized[i] = uint8(q)
	}
	return onsetMax, base64.StdEncoding.EncodeToString(quantized)
}

// AnalyzeRhythm 计算单声道 PCM 样本的节拍结构与起音包络，算法与前端 web/src/lib/lyrics/rhythm/analysis.ts 保持一致
func AnalyzeRhythm(samples []float32, sampleRate int) (*dto.MusicRhythmAnalysisDto, error) {
	if sampleRate <= 0 || len(samples) < rhythmFFTSize {
		return nil, errRhythmAudioTooShort
	}
	frameRate := float64(sampleRate) / float64(rhythmHopSize)
	frames := (len(samples)-rhythmFFTSize)/rhythmHopSize + 1
	if float64(frames) < frameRate*4 {
		return nil, errRhythmAudioTooShort
	}
	durationMs := float64(len(samples)) / float64(sampleRate) * 1000.0
	frameMs := 1000.0 / frameRate
	frameOffsetMs := float64(rhythmFFTSize) / 2.0 / float64(sampleRate) * 1000.0

	// 1. 谱通量起音强度 + 响度
	var win [rhythmFFTSize]float64
	for i := range rhythmFFTSize {
		win[i] = 0.5 - 0.5*math.Cos(2*math.Pi*float64(i)/float64(rhythmFFTSize))
	}
	fft := newFFT1024()
	var re, im [rhythmFFTSize]float64
	var prev [rhythmFFTSize/2 + 1]float64
	flux := make([]float32, frames)
	loud := make([]float32, frames)

	for m := range frames {
		off := m * rhythmHopSize
		energy := 0.0
		for i := range rhythmFFTSize {
			v := float64(samples[off+i])
			re[i] = v * win[i]
			im[i] = 0
			energy += v * v
		}
		loud[m] = float32(10.0 * math.Log10(energy/float64(rhythmFFTSize)+1e-10))
		fft.transform(&re, &im)
		sum := 0.0
		for k := 1; k <= rhythmFFTSize/2; k++ {
			y := math.Log1p(rhythmFluxGamma * math.Hypot(re[k], im[k]))
			d := y - prev[k]
			if d > 0 && m > 0 {
				sum += d
			}
			prev[k] = y
		}
		flux[m] = float32(sum)
	}

	trend := rhythmMovingAverage(flux, int(math.Round(0.4*frameRate)))
	onset := make([]float32, frames)
	squares := 0.0
	for m := range frames {
		v := float64(flux[m] - trend[m])
		if v < 0 {
			v = 0
		}
		onset[m] = float32(v)
		squares += v * v
	}
	rms := math.Sqrt(squares / float64(frames))
	if rms == 0 {
		rms = 1
	}
	invRMS := float32(1.0 / rms)
	for m := range frames {
		onset[m] *= invRMS
	}
	loudSmooth := rhythmMovingAverage(loud, int(math.Round(0.25*frameRate)))

	// 2. 拍速：自相关后按八度族折叠
	maxLag := int(math.Ceil(frameRate * rhythmMaxPeriodS * rhythmCombHarmonics))
	autocorr := make([]float64, maxLag+2)
	for tau := 0; tau <= maxLag+1; tau++ {
		if tau >= frames {
			break
		}
		sum := 0.0
		limit := frames - tau
		for m := range limit {
			sum += float64(onset[m]) * float64(onset[m+tau])
		}
		autocorr[tau] = sum / float64(limit)
	}

	interpR := func(tau float64) float64 {
		i := int(math.Floor(tau))
		if i < 0 || i+1 >= len(autocorr) {
			return 0
		}
		f := tau - float64(i)
		return autocorr[i]*(1-f) + autocorr[i+1]*f
	}
	familyScore := func(tau float64) float64 {
		return interpR(tau/2) + interpR(tau) + 0.5*interpR(2*tau)
	}

	familyBest := frameRate * 0.5
	bestFamily := familyScore(familyBest)
	for tau := frameRate * 0.5; tau < frameRate; tau += 0.25 {
		if s := familyScore(tau); s > bestFamily {
			familyBest = tau
			bestFamily = s
		}
	}

	prior := func(tau float64) float64 {
		octaves := math.Log2(tau / frameRate / rhythmTempoPriorS)
		z := octaves / rhythmTempoPriorSig
		return math.Exp(-0.5 * z * z)
	}
	comb := func(tau float64) float64 {
		sum := 0.0
		for k := 1; k <= rhythmCombHarmonics; k++ {
			sum += interpR(float64(k)*tau) / float64(k)
		}
		return sum
	}
	tempoScore := func(tau float64) float64 {
		return prior(tau) * comb(tau)
	}

	minTau := frameRate * rhythmMinPeriodS
	maxTau := frameRate * rhythmMaxPeriodS
	period := familyBest
	bestTempoScore := -1.0
	for _, candidate := range []float64{familyBest / 2, familyBest, familyBest * 2} {
		if candidate < minTau || candidate > maxTau {
			continue
		}
		if s := tempoScore(candidate); bestTempoScore < 0 || s > bestTempoScore {
			period = candidate
			bestTempoScore = s
		}
	}

	confidence := 0.0
	if autocorr[0] > 0 {
		confidence = interpR(period) / autocorr[0]
	}

	// 3. 节拍：动态规划
	beatFrames := rhythmTrackBeats(onset, period, frames)
	loudFloor := math.Min(rhythmPercentile(loudSmooth, 0.05)+6, rhythmPercentile(loudSmooth, 0.5)-3)
	beats := make([]dto.MusicRhythmBeatDto, 0, len(beatFrames))
	for _, b := range beatFrames {
		if float64(loudSmooth[b]) > loudFloor {
			beats = append(beats, dto.MusicRhythmBeatDto{
				T:        roundFloat(float64(b)*frameMs+frameOffsetMs, 2),
				Loud:     roundFloat(float64(loudSmooth[b]), 2),
				Strength: roundFloat(float64(onset[b]), 3),
			})
		}
	}

	autocorrOut := make([]float64, len(autocorr))
	for i, v := range autocorr {
		autocorrOut[i] = roundFloat(v, 4)
	}
	onsetMax, onsetData := encodeRhythmOnset(onset)

	periodMs := period * frameMs
	return &dto.MusicRhythmAnalysisDto{
		AlgoVersion:   RhythmAlgoVersion,
		DurationMs:    roundFloat(durationMs, 2),
		FrameMs:       roundFloat(frameMs, 4),
		FrameOffsetMs: roundFloat(frameOffsetMs, 4),
		PeriodMs:      roundFloat(periodMs, 4),
		BasePeriodMs:  roundFloat(familyBest*frameMs, 4),
		BPM:           roundFloat(60000.0/periodMs, 4),
		Confidence:    roundFloat(confidence, 4),
		LoudLow:       roundFloat(rhythmPercentile(loudSmooth, 0.1), 4),
		LoudHigh:      roundFloat(rhythmPercentile(loudSmooth, 0.95), 4),
		Beats:         beats,
		Autocorr:      autocorrOut,
		OnsetMax:      onsetMax,
		OnsetData:     onsetData,
	}, nil
}

// normalizeAndValidateRhythmAnalysis 校验节拍分析结果的数值边界与完整时长（防 VIP 30s 试听片段与脏数据入库）
func normalizeAndValidateRhythmAnalysis(in *dto.MusicRhythmAnalysisDto, expectedDurationMs int64) (*dto.MusicRhythmAnalysisDto, *errs.ServiceError) {
	if in == nil {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	scalars := []float64{
		in.DurationMs, in.FrameMs, in.FrameOffsetMs,
		in.PeriodMs, in.BasePeriodMs, in.BPM, in.Confidence,
		in.LoudLow, in.LoudHigh, in.OnsetMax,
	}
	for _, v := range scalars {
		if !isFiniteFloat(v) {
			return nil, errs.NewBadRequest("invalid_request_parameters")
		}
	}
	if in.DurationMs < 4000 || in.DurationMs > rhythmMaxDurationMs ||
		in.FrameMs <= 0 || in.FrameMs > 100 ||
		in.FrameOffsetMs < 0 || in.FrameOffsetMs > 1000 ||
		in.PeriodMs < 100 || in.PeriodMs > 5000 ||
		in.BasePeriodMs < 100 || in.BasePeriodMs > 5000 ||
		in.BPM < 12 || in.BPM > 600 ||
		in.Confidence < 0 || in.Confidence > 1 ||
		in.OnsetMax < 0 || in.OnsetMax > 100 ||
		len(in.Beats) > rhythmMaxBeats ||
		len(in.Autocorr) > rhythmMaxAutocorr ||
		len(in.OnsetData) > rhythmMaxOnsetBase64 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}

	if in.OnsetData != "" {
		decoded, err := base64.StdEncoding.DecodeString(in.OnsetData)
		if err != nil || len(decoded) > rhythmMaxOnsetBytes {
			return nil, errs.NewBadRequest("invalid_request_parameters")
		}
	}

	// 校验歌曲完整度：避免 30s / 60s 试听残片覆盖全站缓存
	if expectedDurationMs > 45_000 {
		exp := float64(expectedDurationMs)
		if in.DurationMs < exp*0.8 && math.Abs(in.DurationMs-exp) > 10_000 {
			return nil, errs.NewBadRequest("rhythm_trial_or_incomplete")
		}
	}

	algoVersion := in.AlgoVersion
	if algoVersion <= 0 {
		algoVersion = RhythmAlgoVersion
	}

	beats := make([]dto.MusicRhythmBeatDto, len(in.Beats))
	for i, b := range in.Beats {
		if !isFiniteFloat(b.T) || !isFiniteFloat(b.Loud) || !isFiniteFloat(b.Strength) || b.T < 0 {
			return nil, errs.NewBadRequest("invalid_request_parameters")
		}
		beats[i] = dto.MusicRhythmBeatDto{
			T:        roundFloat(b.T, 2),
			Loud:     roundFloat(b.Loud, 2),
			Strength: roundFloat(b.Strength, 3),
		}
	}

	autocorr := make([]float64, len(in.Autocorr))
	for i, v := range in.Autocorr {
		if !isFiniteFloat(v) {
			return nil, errs.NewBadRequest("invalid_request_parameters")
		}
		autocorr[i] = roundFloat(v, 4)
	}

	return &dto.MusicRhythmAnalysisDto{
		AlgoVersion:   algoVersion,
		DurationMs:    roundFloat(in.DurationMs, 2),
		FrameMs:       roundFloat(in.FrameMs, 4),
		FrameOffsetMs: roundFloat(in.FrameOffsetMs, 4),
		PeriodMs:      roundFloat(in.PeriodMs, 4),
		BasePeriodMs:  roundFloat(in.BasePeriodMs, 4),
		BPM:           roundFloat(in.BPM, 4),
		Confidence:    roundFloat(in.Confidence, 4),
		LoudLow:       roundFloat(in.LoudLow, 4),
		LoudHigh:      roundFloat(in.LoudHigh, 4),
		Beats:         beats,
		Autocorr:      autocorr,
		OnsetMax:      roundFloat(in.OnsetMax, 4),
		OnsetData:     in.OnsetData,
	}, nil
}
