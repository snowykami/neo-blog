package service

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// 歌词结构的预标注（见 docs/music-player-spec.md 7.2b）：从时间轴与歌词文字直接算出，写进送给模型的歌词，
// 模型据此认副歌、挑聚光灯、安排前奏 / 间奏 / 尾奏的「时刻」，不必自己估：
// - 每行唱多久（lyricTimedLine.End − Start）
// - 重复行：归一化后文字相同的行编为一组，连续几行一起重复多半就是副歌
// - 间奏：与前端时间轴的判断一致（见 lyricInterludeMinGapMs），前奏、尾奏用同一个阈值
// - 对唱与背景人声：来自 TTML（lyricTimedLine.Singer / Background）
const (
	// 前端（lib/lyrics/timeline.ts）把相邻两行之间不短于 7 秒的空隙显示为间奏；预处理（preprocess.ts）会让每行最多提前 600ms 起唱，
	// 换算到原始时间轴为 7.6 秒，前奏（第一行之前）同理。尾奏没有对应的显示，用同一个阈值
	lyricInterludeMinGapMs = 7000 + 600
	// 重复行：归一化后的文字至少这么多个字（单个的「啊」「Oh」之类不算）
	lyricRepeatMinRunes = 2
	// 近似重复：再唱时换了一两个词的行（「僕ら / 僕が」「奇跡 / 試練」）。两行都不短于 lyricVariedMinRunes 个字、
	// 编辑距离相似度不低于 lyricVariedMinSimilarity 时归入同一组，标为「有变化的重复」。
	// 线上 394 首歌实测（2026-11）：抽查的近似对大多是同一句换了词，或几段主歌同一位置的平行句；署名行另行排除
	lyricVariedMinRunes      = 6
	lyricVariedMinSimilarity = 0.8
)

// lyricStructure 与歌词行一一对应的结构信息
type lyricStructure struct {
	// 平台歌词首尾的署名行（作词、作曲等，前端不显示），不算唱的时间，也不参与重复分组
	Credit []bool
	// 每行的重复组编号（从 1 开始，按第一次出现的顺序），不和其他行重复时为 0
	Repeat []int
	// 这一行只与组内其他行近似（文字有变化），没有完全相同的行
	Varied []bool
	// 每行之前没有人唱的时长（毫秒，不短于 lyricInterludeMinGapMs 时才记）：第 0 行之前为前奏，其余为间奏
	GapBefore []int64
	// 最后一句唱完到歌曲结束的时长（毫秒，不短于 lyricInterludeMinGapMs 且已知歌曲时长时才记）
	Outro int64
}

// lyricStructureOf 按各行的时间与文字算出结构；info.Timed 与送去标注的歌词行一一对应
func lyricStructureOf(info lyricAnnotationInfo) lyricStructure {
	timed := info.Timed
	result := lyricStructure{Credit: make([]bool, len(timed)), GapBefore: make([]int64, len(timed))}
	// TTML 不去署名行（与前端一致）
	if !strings.HasPrefix(info.Source, "ttml") {
		texts := make([]string, len(timed))
		for i, line := range timed {
			texts[i] = line.Text
		}
		head, tail := lyricCreditRange(texts, info.Title, info.Artists)
		for i := range timed {
			result.Credit[i] = i < head || i >= tail
		}
	}
	result.Repeat, result.Varied = lyricRepeatGroups(timed, result.Credit)

	// 有人唱的时段：主唱行与背景人声各算一段（前端把背景人声显示为单独的一行，同样占掉空隙）；
	// 与前端一样按开始时间排序后只比较相邻两段，结束时间未知的行不参与（逐行歌词）
	type span struct {
		line       int
		start, end int64
	}
	var spans []span
	for i, line := range timed {
		if result.Credit[i] || line.Start < 0 || line.End <= line.Start {
			continue
		}
		spans = append(spans, span{line: i, start: line.Start, end: line.End})
		if bg := line.Background; bg != nil && bg.End > bg.Start {
			spans = append(spans, span{line: i, start: bg.Start, end: bg.End})
		}
	}
	if len(spans) == 0 {
		return result
	}
	slices.SortStableFunc(spans, func(a, b span) int { return int(a.start - b.start) })
	if spans[0].start >= lyricInterludeMinGapMs {
		result.GapBefore[spans[0].line] = spans[0].start
	}
	last := spans[0].end
	for k := 1; k < len(spans); k++ {
		if gap := spans[k].start - spans[k-1].end; gap >= lyricInterludeMinGapMs && result.GapBefore[spans[k].line] == 0 {
			result.GapBefore[spans[k].line] = gap
		}
		last = max(last, spans[k].end)
	}
	if outro := info.Duration - last; info.Duration > 0 && outro >= lyricInterludeMinGapMs {
		result.Outro = outro
	}
	return result
}

// lyricRepeatGroups 重复行的分组：按 normalizeLyricMatch（忽略空白、标点、大小写）后的文字比较，文字相同的行、近似的行（见 lyricVariedMinSimilarity）
// 归入同一组，至少两行的组按第一次出现的顺序编号；太短的行（语气词）与署名行不分组。varied 为只有近似、没有完全相同的行
func lyricRepeatGroups(timed []lyricTimedLine, credit []bool) (groups []int, varied []bool) {
	n := len(timed)
	keys := make([][]rune, n)
	counts := map[string]int{}
	for i, line := range timed {
		if credit[i] {
			continue
		}
		if key := []rune(normalizeLyricMatch(line.Text)); len(key) >= lyricRepeatMinRunes {
			keys[i] = key
			counts[string(key)]++
		}
	}
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(i int) int {
		if parent[i] != i {
			parent[i] = find(parent[i])
		}
		return parent[i]
	}
	union := func(a, b int) {
		if ra, rb := find(a), find(b); ra != rb {
			parent[max(ra, rb)] = min(ra, rb)
		}
	}
	first := map[string]int{}
	for i, key := range keys {
		if key == nil {
			continue
		}
		if j, ok := first[string(key)]; ok {
			union(i, j)
		} else {
			first[string(key)] = i
		}
	}
	// 近似：只比较各个不同的文字一次；署名样式的行（歌词中间的「曲：…」等）不参与
	fuzzy := func(i int) bool {
		return keys[i] != nil && len(keys[i]) >= lyricVariedMinRunes && !isLyricCreditText(timed[i].Text)
	}
	distinct := make([]int, 0, len(first))
	for i, key := range keys {
		if key != nil && first[string(key)] == i && fuzzy(i) {
			distinct = append(distinct, i)
		}
	}
	similar := make([]bool, n)
	for a := 0; a < len(distinct); a++ {
		for b := a + 1; b < len(distinct); b++ {
			i, j := distinct[a], distinct[b]
			if lyricSimilarity(keys[i], keys[j]) >= lyricVariedMinSimilarity {
				union(i, j)
				similar[i], similar[j] = true, true
			}
		}
	}
	sizes := make([]int, n)
	for i, key := range keys {
		if key != nil {
			sizes[find(i)]++
		}
	}
	groups, varied = make([]int, n), make([]bool, n)
	numbers := map[int]int{}
	for i, key := range keys {
		root := find(i)
		if key == nil || sizes[root] < 2 {
			continue
		}
		if numbers[root] == 0 {
			numbers[root] = len(numbers) + 1
		}
		groups[i] = numbers[root]
		varied[i] = counts[string(key)] < 2 && similar[first[string(key)]]
	}
	return groups, varied
}

// lyricSimilarity 两段文字的相似度：1 − 编辑距离 / 较长者的字数；长度相差太多时直接返回 0（不可能达到阈值）
func lyricSimilarity(a, b []rune) float64 {
	if len(a) < len(b) {
		a, b = b, a
	}
	if len(a) == 0 || float64(len(b)) < float64(len(a))*lyricVariedMinSimilarity {
		return 0
	}
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return 1 - float64(prev[len(b)])/float64(len(a))
}

// 平台歌词首尾署名行的判断，与前端 lib/lyrics/strip-credits.ts 一致（规则参考 StarryPlayer）：
// 「歌名 - 歌手」、「词：…」「作曲 : …」「Producer: …」、「未经许可不得翻唱…」等；只看开头（最多 16 行）与结尾（最多 8 行）连续的署名行
const (
	lyricCreditHeadMaxLines    = 16
	lyricCreditTailMaxLines    = 8
	lyricCreditHeadingMaxLines = 3
	lyricCreditKeyMaxRunes     = 12
	lyricCreditColonWithin     = 24
)

var (
	lyricCreditNotices   = []string{"未经许可", "未經許可", "不得翻唱", "禁止翻唱"}
	lyricCreditPrefixes  = []string{"lyrics by ", "music by ", "composed by ", "written by ", "produced by ", "arranged by ", "mixed by ", "mastered by "}
	lyricCreditExactKeys = []string{"op", "sp", "isrc", "pv", "mv"}
	lyricCreditKeywords  = []string{
		"词", "詞", "曲", "编", "編", "制作", "製作", "监制", "監製", "出品", "发行", "發行", "演唱", "原唱", "翻唱", "歌手",
		"混音", "缩混", "录音", "錄音", "母带", "母帶", "和声", "和聲", "合声", "合聲", "配唱", "吉他", "贝斯", "貝斯", "鼓",
		"键盘", "鍵盤", "钢琴", "鋼琴", "弦乐", "弦樂", "人声", "人聲", "伴奏", "策划", "企划", "企劃", "统筹", "統籌", "出版",
		"版权", "版權", "宣传", "推广", "监修", "監修", "录制", "錄製",
		"lyric", "compos", "arrang", "produc", "writ", "mix", "master", "vocal", "record", "engineer", "guitar", "bass",
		"drum", "piano", "keyboard", "strings", "publish", "label",
	}
	lyricCreditDashRe = regexp.MustCompile(`[-—–]`)
)

// isLyricCreditText 一行是否为署名（同前端 isCreditText）
func isLyricCreditText(text string) bool {
	lower := strings.ToLower(text)
	for _, notice := range lyricCreditNotices {
		if strings.Contains(lower, notice) {
			return true
		}
	}
	for _, prefix := range lyricCreditPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	runes := []rune(text)
	colon := slices.IndexFunc(runes[:min(len(runes), lyricCreditColonWithin)], func(r rune) bool { return r == ':' || r == '：' })
	if colon < 0 {
		return false
	}
	key := normalizeLyricMatch(string(runes[:colon]))
	if key == "" || utf8.RuneCountInString(key) > lyricCreditKeyMaxRunes {
		return false
	}
	if slices.Contains(lyricCreditExactKeys, key) {
		return true
	}
	return slices.ContainsFunc(lyricCreditKeywords, func(keyword string) bool { return strings.Contains(key, keyword) })
}

// lyricCreditRange 去掉首尾署名行后剩下的歌词范围 [head, tail)（同前端 stripCredits）：开头的署名行与前几行里只有歌名或歌手的行、
// 结尾的署名行；全是署名行时视为没有署名行
func lyricCreditRange(texts []string, title string, artists []string) (head, tail int) {
	if len(texts) <= 1 {
		return 0, len(texts)
	}
	normalizedTitle := normalizeLyricMatch(title)
	var normalizedArtists []string
	for _, artist := range artists {
		if key := normalizeLyricMatch(artist); key != "" {
			normalizedArtists = append(normalizedArtists, key)
		}
	}
	isTitleLine := func(text string) bool {
		if normalizedTitle == "" || !lyricCreditDashRe.MatchString(text) {
			return false
		}
		normalized := normalizeLyricMatch(text)
		return strings.Contains(normalized, normalizedTitle) && (len(normalizedArtists) == 0 ||
			slices.ContainsFunc(normalizedArtists, func(artist string) bool { return strings.Contains(normalized, artist) }))
	}
	isMetadata := func(text string) bool {
		text = strings.TrimSpace(text)
		return text == "" || isLyricCreditText(text) || isTitleLine(text)
	}
	isHeading := func(text string) bool {
		normalized := normalizeLyricMatch(text)
		return normalized != "" && (normalized == normalizedTitle || slices.Contains(normalizedArtists, normalized))
	}
	for head < min(len(texts), lyricCreditHeadMaxLines) && (isMetadata(texts[head]) || (head < lyricCreditHeadingMaxLines && isHeading(texts[head]))) {
		head++
	}
	tail = len(texts)
	for tail > max(head, len(texts)-lyricCreditTailMaxLines) && isMetadata(texts[tail-1]) {
		tail--
	}
	if head >= tail {
		return 0, len(texts)
	}
	return head, tail
}

// lyricPaceSummary 预处理算出的全曲句子推进时速与松紧反差画像（供模型选择全曲滚动律动预设 motion，以及未走 AI 时的启发式兜底）：
// 基于线上 798 首歌单实测分位数标定（median p10=2.39s / p50=3.57s / p90=5.88s；p25_step p10=1.68s / p50=2.85s；
// rapid <1.5s p75=8% / p90=19%；units/s p50=2.33 / p90=3.56；held >=1.5s p50=8% / p75=18%；step_cv p50=0.39 / p75=0.46），
// 让模型客观感知歌词在屏幕上滚动换行的真实物理快慢、段落爆发反差与留白长音比例。
type lyricPaceSummary struct {
	Valid          bool
	MedianStepSec  float64
	P25StepSec     float64
	SurgeRatio     float64
	LinesPerMin    float64
	RapidPct       int
	UltraRapidPct  int
	UnitsPerSec    float64
	HeldPct        int
	LivelyPunctPct int
	RepeatPct      int
	StepCV         float64
	Suggested      string
	RangeHint      string
}

func (p lyricPaceSummary) format() string {
	if !p.Valid {
		return ""
	}
	if p.UnitsPerSec > 0.1 {
		return fmt.Sprintf("median %.2fs/line, p25 %.2fs/line (%.2fx surge, ~%.0f lines/min, %d%% rapid <1.5s steps, %.1f vocal units/s, %d%% held notes, step CV %.2f — %s)",
			p.MedianStepSec, p.P25StepSec, p.SurgeRatio, p.LinesPerMin, p.RapidPct, p.UnitsPerSec, p.HeldPct, p.StepCV, p.RangeHint)
	}
	return fmt.Sprintf("median %.2fs/line, p25 %.2fs/line (%.2fx surge, ~%.0f lines/min, %d%% rapid <1.5s steps, step CV %.2f — %s)",
		p.MedianStepSec, p.P25StepSec, p.SurgeRatio, p.LinesPerMin, p.RapidPct, p.StepCV, p.RangeHint)
}

func hasLivelyLyricPunct(text string) bool {
	return strings.ContainsAny(text, "!！?？~～♪☆♡")
}

// classifyLyricMotionFromPace 按线上歌单实测分布标定出的 6 档滚动预设粗略区间与推荐提示
func classifyLyricMotionFromPace(med, p25, surge float64, rapid, ultra int, ups float64, held, lively, repeatPct int, cv float64) (suggested, hint string) {
	// 1. crisp（干脆磁吸）：高速密集说唱 / 电子 / 疾走快切
	if med <= 2.30 || p25 <= 1.60 || rapid >= 22 || ultra >= 10 || (ups >= 3.90 && p25 <= 2.20) {
		return "crisp", "fast / dense line turnover, empirically calibrated for crisp or bouncy (avoid gentle/plush)"
	}

	// 2. gentle（舒缓呼吸）：从容慢抒情 / 留白长音（连快段 p25 都偏舒缓）
	if p25 >= 3.25 && rapid <= 5 && ((med >= 5.15 && (ups == 0 || ups <= 2.55)) || (med >= 4.55 && held >= 20) || med >= 5.75) {
		return "gentle", "slow / spacious phrasing, empirically calibrated for gentle or plush (avoid crisp/bouncy)"
	}

	// 3. bouncy（俏皮快弹）：轻快跳跃 / 元气电波 / 副歌活泼点踏
	if (med <= 3.05 && (rapid >= 7 || p25 <= 2.20 || ups >= 2.85 || lively >= 8)) ||
		(p25 <= 2.05 && held <= 12 && med <= 3.55) ||
		(lively >= 12 && med <= 3.75 && held <= 15) {
		return "bouncy", "upbeat / lively step rhythm, empirically calibrated for bouncy, flow, or crisp (avoid gentle)"
	}

	// 4. cascade（扇入推镜）：戏剧张力强、主副歌松紧反差显著（高 step CV 或高主副歌提速比）
	if (cv >= 0.45 && med >= 2.85 && med <= 5.50 && (held >= 12 || surge >= 1.45 || repeatPct >= 28)) ||
		(surge >= 1.75 && med >= 3.80 && (held >= 10 || repeatPct >= 22)) ||
		(cv >= 0.52 && med <= 5.40) {
		return "cascade", "dramatic dynamic contrast (verse-to-chorus surge), empirically calibrated for cascade, plush, or flow"
	}

	// 5. plush（云朵慢弹）：温润绵软慢回弹，广泛适配中速/中慢速温暖流行、R&B、City Pop、治愈系与抒情律动
	if (med >= 3.40 && med <= 5.45 && rapid <= 8 && (ups == 0 || ups <= 2.95)) ||
		(med >= 3.00 && med <= 4.40 && held <= 10 && cv < 0.42 && (ups == 0 || ups <= 2.70)) {
		return "plush", "warm relaxed mid-tempo groove, empirically calibrated for plush, flow, or gentle (avoid crisp)"
	}

	// 6. flow（丝滑波浪）：匀称连贯推进的经典流行 / 叙事摇滚 / J-Pop
	return "flow", "steady balanced cadence, empirically calibrated for flow, plush, or bouncy depending on mood"
}

func countLyricVocalUnits(text string) int {
	units := 0
	inLatinWord := false
	for _, r := range text {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			inLatinWord = false
			continue
		}
		if r <= 0x024F || (r >= 0x0400 && r <= 0x04FF) {
			if !inLatinWord {
				units++
				inLatinWord = true
			}
		} else {
			inLatinWord = false
			units++
		}
	}
	return units
}

func lyricPaceSummaryOf(info lyricAnnotationInfo) lyricPaceSummary {
	timed := info.Timed
	if len(timed) < 5 {
		return lyricPaceSummary{}
	}
	credit := make([]bool, len(timed))
	if !strings.HasPrefix(info.Source, "ttml") {
		texts := make([]string, len(timed))
		for i, l := range timed {
			texts[i] = l.Text
		}
		head, tail := lyricCreditRange(texts, info.Title, info.Artists)
		for i := range timed {
			credit[i] = i < head || i >= tail
		}
	}
	repeatGroups, _ := lyricRepeatGroups(timed, credit)

	type mainSpan struct {
		start  int64
		end    int64
		units  int
		held   bool
		lively bool
		repeat bool
	}
	var mains []mainSpan
	for i, l := range timed {
		if credit[i] || l.Start < 0 {
			continue
		}
		u := countLyricVocalUnits(l.Text)
		if u == 0 {
			continue
		}
		held := l.Held != nil
		if !held && l.End > l.Start && (l.End-l.Start) >= 4800 && u <= 8 {
			held = true
		}
		mains = append(mains, mainSpan{
			start:  l.Start,
			end:    l.End,
			units:  u,
			held:   held,
			lively: hasLivelyLyricPunct(l.Text),
			repeat: i < len(repeatGroups) && repeatGroups[i] > 0,
		})
	}
	if len(mains) < 5 {
		return lyricPaceSummary{}
	}
	slices.SortStableFunc(mains, func(a, b mainSpan) int { return int(a.start - b.start) })

	var stepsMs []int64
	rapidCount := 0
	ultraRapidCount := 0
	heldCount := 0
	livelyCount := 0
	repeatCount := 0
	var totalUnits int
	var totalDurMs int64
	for i, m := range mains {
		if m.held {
			heldCount++
		}
		if m.lively {
			livelyCount++
		}
		if m.repeat {
			repeatCount++
		}
		if m.end > m.start {
			dur := m.end - m.start
			if dur >= 250 && dur <= 20000 {
				totalUnits += m.units
				totalDurMs += dur
			}
		}
		if i == 0 {
			continue
		}
		prev := mains[i-1]
		step := m.start - prev.start
		// 跳过几乎同时开唱的双声部并列句（< 180ms），避免把同步合唱误算成极速切句
		if step < 180 {
			continue
		}
		// 跳过间奏级大空隙
		gap := step
		if prev.end > prev.start {
			gap = m.start - prev.end
		}
		if gap >= lyricInterludeMinGapMs || step > 14000 {
			continue
		}
		stepsMs = append(stepsMs, step)
		if step < 1500 {
			rapidCount++
		}
		if step < 1050 {
			ultraRapidCount++
		}
	}
	if len(stepsMs) < 4 {
		return lyricPaceSummary{}
	}
	slices.Sort(stepsMs)
	n := len(stepsMs)
	var medianMs float64
	if n%2 == 1 {
		medianMs = float64(stepsMs[n/2])
	} else {
		medianMs = float64(stepsMs[n/2-1]+stepsMs[n/2]) / 2.0
	}
	medianSec := medianMs / 1000.0
	if medianSec <= 0.1 {
		return lyricPaceSummary{}
	}
	p25Sec := float64(stepsMs[n/4]) / 1000.0
	if p25Sec <= 0.1 {
		p25Sec = medianSec
	}
	surgeRatio := medianSec / max(0.2, p25Sec)

	var sumMs float64
	for _, s := range stepsMs {
		sumMs += float64(s)
	}
	meanMs := sumMs / float64(n)
	var stepCV float64
	if meanMs > 1 {
		var variance float64
		for _, s := range stepsMs {
			diff := float64(s) - meanMs
			variance += diff * diff
		}
		stepCV = math.Sqrt(variance/float64(n)) / meanMs
	}

	linesPerMin := 60.0 / medianSec
	rapidPct := (rapidCount*100 + n/2) / n
	ultraRapidPct := (ultraRapidCount*100 + n/2) / n
	mCount := len(mains)
	heldPct := (heldCount*100 + mCount/2) / mCount
	livelyPct := (livelyCount*100 + mCount/2) / mCount
	repeatPct := (repeatCount*100 + mCount/2) / mCount
	var unitsPerSec float64
	if totalDurMs >= 2000 {
		unitsPerSec = float64(totalUnits) / (float64(totalDurMs) / 1000.0)
	}

	suggested, hint := classifyLyricMotionFromPace(
		medianSec, p25Sec, surgeRatio, rapidPct, ultraRapidPct, unitsPerSec, heldPct, livelyPct, repeatPct, stepCV,
	)

	return lyricPaceSummary{
		Valid:          true,
		MedianStepSec:  medianSec,
		P25StepSec:     p25Sec,
		SurgeRatio:     surgeRatio,
		LinesPerMin:    linesPerMin,
		RapidPct:       rapidPct,
		UltraRapidPct:  ultraRapidPct,
		UnitsPerSec:    unitsPerSec,
		HeldPct:        heldPct,
		LivelyPunctPct: livelyPct,
		RepeatPct:      repeatPct,
		StepCV:         stepCV,
		Suggested:      suggested,
		RangeHint:      hint,
	}
}

func suggestHeuristicLyricMotion(info lyricAnnotationInfo) string {
	if pace := lyricPaceSummaryOf(info); pace.Valid && lyricAnnotationMotions[pace.Suggested] {
		return pace.Suggested
	}
	return "plush"
}
