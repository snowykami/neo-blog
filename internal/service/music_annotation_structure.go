package service

import (
	"regexp"
	"slices"
	"strings"
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
