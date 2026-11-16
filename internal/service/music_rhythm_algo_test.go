package service

import (
	"encoding/base64"
	"math"
	"testing"
)

type testDrumPattern struct {
	beats map[string][]float64
	gain  map[string]float64
}

var testDrumPatterns = map[string]testDrumPattern{
	"pop": {
		beats: map[string][]float64{
			"kick":  {0, 2},
			"snare": {1, 3},
			"hat":   {0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5},
		},
		gain: map[string]float64{"kick": 1, "snare": 0.55, "hat": 0.12},
	},
	"half_time": {
		beats: map[string][]float64{
			"kick":  {0},
			"snare": {2},
			"hat":   {0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5},
		},
		gain: map[string]float64{"kick": 1, "snare": 0.5, "hat": 0.13},
	},
	"hat_led": {
		beats: map[string][]float64{
			"kick":  {},
			"snare": {1, 3},
			"hat":   {0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5},
		},
		gain: map[string]float64{"kick": 0, "snare": 0.5, "hat": 0.16},
	},
}

func testDrumTrack(bpm float64, patternName string, seconds float64) []float32 {
	const rate = 11025.0
	samples := make([]float32, int(math.Round(seconds*rate)))
	state := int64(1)
	randSample := func() float64 {
		state = (state * 16807) % 2147483647
		return float64(state)/2147483647.0*2.0 - 1.0
	}
	beatMs := 60000.0 / bpm
	pattern := testDrumPatterns[patternName]
	add := func(tMs float64, length int, render func(t float64) float64) {
		start := int(math.Round(tMs / 1000.0 * rate))
		for i := 0; i < length && start+i < len(samples); i++ {
			if start+i >= 0 {
				samples[start+i] += float32(render(float64(i) / rate))
			}
		}
	}
	for barStart := 400.0; barStart < seconds*1000.0-200.0; barStart += beatMs * 4.0 {
		for _, pos := range pattern.beats["kick"] {
			add(barStart+pos*beatMs, int(math.Round(0.16*rate)), func(t float64) float64 {
				return pattern.gain["kick"] * math.Sin(2*math.Pi*(110*math.Exp(-t/0.02)+50)*t) * math.Exp(-t/0.045)
			})
		}
		for _, pos := range pattern.beats["snare"] {
			add(barStart+pos*beatMs, int(math.Round(0.12*rate)), func(t float64) float64 {
				return pattern.gain["snare"] * (math.Sin(2*math.Pi*190*t)*0.35 + randSample()*0.9) * math.Exp(-t/0.035)
			})
		}
		for _, pos := range pattern.beats["hat"] {
			swing := 0.0
			if pos == math.Trunc(pos) && int(pos)%2 == 1 {
				swing = beatMs * 0.02
			}
			last := 0.0
			add(barStart+pos*beatMs+swing, int(math.Round(0.06*rate)), func(t float64) float64 {
				v := randSample()
				high := v - last
				last = v
				return pattern.gain["hat"] * high * math.Exp(-t/0.01)
			})
		}
	}
	return samples
}

func testOctaveError(gotBPM, wantBPM float64) int {
	return int(math.Round(math.Log2(gotBPM / wantBPM)))
}

func TestAnalyzeRhythmTempoAccuracy(t *testing.T) {
	tempos := []float64{88, 96, 100, 120, 140, 160}
	for name := range testDrumPatterns {
		for _, bpm := range tempos {
			analysis, err := AnalyzeRhythm(testDrumTrack(bpm, name, 24), rhythmSampleRate)
			if err != nil {
				t.Fatalf("%s %.0f BPM unexpected error: %v", name, bpm, err)
			}
			if oe := testOctaveError(analysis.BPM, bpm); oe != 0 {
				t.Fatalf("%s %.0f BPM -> %.2f BPM (octave err %d)", name, bpm, analysis.BPM, oe)
			}
			if float64(len(analysis.Autocorr)-2)*analysis.FrameMs < 6000 {
				t.Fatalf("%s %.0f BPM autocorr span too short: %.2f ms", name, bpm, float64(len(analysis.Autocorr)-2)*analysis.FrameMs)
			}
		}
	}
}

func TestAnalyzeRhythmExtremesAndConsistency(t *testing.T) {
	tempos := []float64{74, 88, 96, 100, 120, 140, 160, 172, 180}
	for name := range testDrumPatterns {
		for _, bpm := range tempos {
			analysis, err := AnalyzeRhythm(testDrumTrack(bpm, name, 24), rhythmSampleRate)
			if err != nil {
				t.Fatalf("%s %.0f BPM unexpected error: %v", name, bpm, err)
			}
			if oe := math.Abs(float64(testOctaveError(analysis.BPM, bpm))); oe > 1 {
				t.Fatalf("%s %.0f BPM -> %.2f BPM exceeds 1 octave", name, bpm, analysis.BPM)
			}
			if analysis.BasePeriodMs < 480 || analysis.BasePeriodMs >= 1000 {
				t.Fatalf("%s %.0f BPM basePeriodMs = %.2f out of [480, 1000)", name, bpm, analysis.BasePeriodMs)
			}
			if diff := math.Abs(math.Log2(analysis.BasePeriodMs / analysis.PeriodMs)); diff > 1.05 {
				t.Fatalf("%s %.0f BPM |log2(base/period)| = %.3f > 1.05", name, bpm, diff)
			}
		}
	}
}

func TestAnalyzeRhythmHeavyCompressionAndShortAudio(t *testing.T) {
	flat := testDrumTrack(120, "pop", 24)
	for i, v := range flat {
		flat[i] = float32(math.Tanh(float64(v)*6.0) * 0.9)
	}
	analysis, err := AnalyzeRhythm(flat, rhythmSampleRate)
	if err != nil {
		t.Fatalf("heavy compression failed: %v", err)
	}
	if len(analysis.Beats) <= 30 {
		t.Fatalf("expected > 30 beats, got %d", len(analysis.Beats))
	}
	if oe := testOctaveError(analysis.BPM, 120); oe != 0 {
		t.Fatalf("compressed 120 BPM -> %.2f", analysis.BPM)
	}

	if _, err := AnalyzeRhythm(make([]float32, rhythmSampleRate*2), rhythmSampleRate); err != errRhythmAudioTooShort {
		t.Fatalf("short audio err = %v, want %v", err, errRhythmAudioTooShort)
	}
}

func TestRhythmOnsetQuantizationAndValidation(t *testing.T) {
	analysis, err := AnalyzeRhythm(testDrumTrack(120, "pop", 12), rhythmSampleRate)
	if err != nil {
		t.Fatal(err)
	}
	if analysis.OnsetMax <= 0 || analysis.OnsetData == "" {
		t.Fatalf("expected quantized onset curve, got max=%.4f len=%d", analysis.OnsetMax, len(analysis.OnsetData))
	}
	rawBytes, decErr := base64.StdEncoding.DecodeString(analysis.OnsetData)
	if decErr != nil {
		t.Fatalf("invalid onset base64: %v", decErr)
	}
	expectedFrames := (12*rhythmSampleRate-rhythmFFTSize)/rhythmHopSize + 1
	if len(rawBytes) != expectedFrames {
		t.Fatalf("onset frames = %d, want %d", len(rawBytes), expectedFrames)
	}

	// 拦截 VIP 30 秒试听片段
	trial := *analysis
	trial.DurationMs = 30_000
	if _, svcErr := normalizeAndValidateRhythmAnalysis(&trial, 240_000); svcErr == nil || svcErr.Message != "rhythm_trial_or_incomplete" {
		t.Fatalf("trial snippet should be rejected, got %v", svcErr)
	}
	// NaN 与坏 Base64 拒绝
	badNaN := *analysis
	badNaN.BPM = math.NaN()
	if _, svcErr := normalizeAndValidateRhythmAnalysis(&badNaN, 0); svcErr == nil {
		t.Fatal("NaN should be rejected")
	}
	badB64 := *analysis
	badB64.OnsetData = "not-valid-base64!!!"
	if _, svcErr := normalizeAndValidateRhythmAnalysis(&badB64, 0); svcErr == nil {
		t.Fatal("invalid base64 should be rejected")
	}
	// 完整时长通过规范化校验
	full := *analysis
	full.DurationMs = 238_000
	if cleaned, svcErr := normalizeAndValidateRhythmAnalysis(&full, 240_000); svcErr != nil || cleaned.AlgoVersion != RhythmAlgoVersion {
		t.Fatalf("valid full duration failed: %+v %v", cleaned, svcErr)
	}
}
