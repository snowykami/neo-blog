package service

import (
	"encoding/xml"
	"errors"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/snowykami/neo-blog/internal/dto"
)

// 全站歌词版本的歌词行（见 docs/music-player-spec.md 7.2o）：选择全站版本（按质量排序）与生成歌词标注都从这里取一个来源的歌词，
// 送去标注的行必须与前端显示这一来源时的行一致（前端按归一化后的行文本匹配标注，空白、标点与大小写不影响）。
// - 平台歌词（LRC / YRC / QRC，酷狗的 KRC 已由后端转换为 QRC）用 lyricTimedLines
// - TTML 只取主唱行：跳过背景人声（x-bg）与翻译、音译（x-translation / x-roman），规则与前端 parse-ttml.ts 一致
// 等级与「自带的翻译、音译项数」与前端 resolve.ts 的 lyricTier / lyricExtras 一致，两边选出的版本相同

var (
	// QQ 音乐、酷狗音乐纯音乐的占位歌词（与前端 from-platform.ts 一致）
	lyricInstrumentalRe = regexp.MustCompile(`纯音乐，请您?欣赏`)
	lyricCJKRe          = regexp.MustCompile(`[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]`)
	lyricLatinRe        = regexp.MustCompile(`\p{Latin}`)
	ttmlMsRe            = regexp.MustCompile(`^\d+(?:\.\d+)?ms$`)
	ttmlSecondsRe       = regexp.MustCompile(`^\d+(?:\.\d+)?s$`)
	ttmlClockRe         = regexp.MustCompile(`^\d+(?::\d+){0,2}(?:\.\d+)?$`)
)

// lyricVersionLines 一个来源按前端规则得到的歌词：具体来源（与前端 ResolvedLyrics.source 一致）、各行（开始时间、文字与长音）、
// 逐行翻译（送给模型的上下文，没有时为 nil）与来源自带的翻译、音译项数（0～2，排序用）
type lyricVersionLines struct {
	Source       string
	WordTimed    bool
	Timed        []lyricTimedLine
	Translations []string
	Extras       int
}

// Texts 各行的文字（送去标注的歌词）
func (v *lyricVersionLines) Texts() []string {
	texts := make([]string, len(v.Timed))
	for i, line := range v.Timed {
		texts[i] = line.Text
	}
	return texts
}

// lyricVersionOf 快照中某一来源（ttml / ncm / qq / kugou）的歌词；没有可显示的歌词时返回 nil
func lyricVersionOf(kind string, snapshot *dto.MusicLyricCacheDto) *lyricVersionLines {
	if snapshot == nil {
		return nil
	}
	switch kind {
	case "ttml":
		return ttmlVersion(snapshot)
	case "ncm":
		return ncmVersion(snapshot.Ncm)
	case "qq":
		if qq := snapshot.QQ; qq != nil {
			return platformVersion(qq.Format, qq.Lyric, qq.Translation, qq.Romanization, "qq-qrc", "qq-lrc")
		}
	case "kugou":
		if kugou := snapshot.Kugou; kugou != nil {
			return platformVersion(kugou.Format, kugou.Lyric, kugou.Translation, kugou.Romanization, "kugou-krc", "kugou-lrc")
		}
	}
	return nil
}

// ncmVersion 网易云：有逐字歌词时用逐字（ncm-yrc），否则用逐行（ncm-lrc）；翻译取同一来源（与原来的标注规则一致，行与哈希不变）
func ncmVersion(lyric *dto.MusicLyricDto) *lyricVersionLines {
	if lyric == nil {
		return nil
	}
	version := &lyricVersionLines{}
	if lyric.Yrc != nil {
		version.Timed = lyricTimedLines(lyric.Yrc.Lyric, lyricAnnotationMaxLines)
		version.Source, version.WordTimed = "ncm-yrc", true
	}
	if len(version.Timed) == 0 && lyric.Lrc != nil {
		version.Timed = lyricTimedLines(lyric.Lrc.Lyric, lyricAnnotationMaxLines)
		version.Source, version.WordTimed = "ncm-lrc", false
	}
	if len(version.Timed) == 0 {
		return nil
	}
	version.Translations = alignLyricTranslations(version.Timed, lyricTranslationSource(lyric, version.WordTimed))
	// 排序时前端不分逐字与逐行，翻译取逐字翻译或逐行翻译中先有的一种
	if lyricHasExtra(version.Timed, firstLyricPart(lyric.Ytlrc, lyric.Tlyric), false) {
		version.Extras++
	}
	if lyricHasExtra(version.Timed, firstLyricPart(lyric.Yromalrc, lyric.Romalrc), false) {
		version.Extras++
	}
	return version
}

// platformVersion QQ 音乐 / 酷狗音乐：format 为 qrc 时为逐字；全是纯音乐占位时没有歌词；音译跳过含中日韩文字的行（多为说明文字）
func platformVersion(format, lyric, translation, romanization, wordSource, lineSource string) *lyricVersionLines {
	timed := lyricTimedLines(lyric, lyricAnnotationMaxLines)
	instrumental := true
	for _, line := range timed {
		instrumental = instrumental && lyricInstrumentalRe.MatchString(line.Text)
	}
	if len(timed) == 0 || instrumental {
		return nil
	}
	version := &lyricVersionLines{Source: lineSource, Timed: timed, Translations: alignLyricTranslations(timed, translation)}
	if format == "qrc" {
		version.Source, version.WordTimed = wordSource, true
	}
	if lyricHasExtra(timed, translation, false) {
		version.Extras++
	}
	if lyricHasExtra(timed, romanization, true) {
		version.Extras++
	}
	return version
}

// ttmlVersion TTML：按网易云歌曲收录的优先（自定义源为 ttml-custom），其次是按匹配到的 QQ 歌曲收录的（与前端一致，记为 ttml-amll）；
// 没有自带翻译时向网易云借（只作为模型的上下文，不算排序的翻译项）
func ttmlVersion(snapshot *dto.MusicLyricCacheDto) *lyricVersionLines {
	text, source := "", "ttml-amll"
	switch {
	case snapshot.TTML != nil && snapshot.TTML.TTML != "":
		text = snapshot.TTML.TTML
		if snapshot.TTML.Source == musicTTMLSourceCustom {
			source = "ttml-custom"
		}
	case snapshot.QQ != nil && snapshot.QQ.TTML != "":
		text = snapshot.QQ.TTML
	default:
		return nil
	}
	parsed := parseTTMLLyrics(text)
	if len(parsed.Lines) == 0 {
		return nil
	}
	version := &lyricVersionLines{Source: source, WordTimed: parsed.WordTimed, Timed: parsed.Lines}
	if parsed.HasTranslation {
		version.Translations = parsed.Translations
		version.Extras++
	} else if snapshot.Ncm != nil {
		version.Translations = alignLyricTranslations(parsed.Lines, firstLyricPart(snapshot.Ncm.Ytlrc, snapshot.Ncm.Tlyric))
	}
	if parsed.HasRomanization {
		version.Extras++
	}
	return version
}

// firstLyricPart 第一种不为空的歌词文本
func firstLyricPart(parts ...*dto.MusicLyricPart) string {
	for _, part := range parts {
		if part != nil && strings.TrimSpace(part.Lyric) != "" {
			return part.Lyric
		}
	}
	return ""
}

// lyricHasExtra 翻译 / 音译（raw）是否至少有一行能按开始时间挂到歌词上（容差同 alignLyricTranslations，网易云的「//」与原文相同的不算）；
// noCJK 时跳过含中日韩文字的行
func lyricHasExtra(lines []lyricTimedLine, raw string, noCJK bool) bool {
	if strings.TrimSpace(raw) == "" {
		return false
	}
	for _, extra := range lyricTimedLines(raw, 0) {
		if extra.Start < 0 || extra.Text == "//" || (noCJK && lyricCJKRe.MatchString(extra.Text)) {
			continue
		}
		for _, line := range lines {
			if line.Start >= 0 && math.Abs(float64(extra.Start-line.Start)) <= lyricTranslationTolerance && extra.Text != line.Text {
				return true
			}
		}
	}
	return false
}

// ttmlLyrics TTML 的主唱行与逐行翻译（与 Lines 一一对应，没有翻译的行为空字符串），以及是否自带翻译、音译与逐字时间
type ttmlLyrics struct {
	Lines           []lyricTimedLine
	Translations    []string
	HasTranslation  bool
	HasRomanization bool
	WordTimed       bool
}

// ttmlNode 解析 TTML 用的极简文档树：元素（本地名、属性与子节点）或文本节点（name 为空）
type ttmlNode struct {
	name     string
	attrs    []xml.Attr
	text     string
	children []*ttmlNode
}

// ttmlWord 一个音节：文字与开始、结束时间（毫秒）
type ttmlWord struct {
	text       string
	start, end int64
}

// parseTTMLLyrics 解析 TTML 的主唱行（规则见文件开头）：p 为一行，带时间的 span 为音节，span 之间的空白归到前一个音节；
// 没有音节时间的行整行为一个音节；行按开始时间排序（与前端预处理一致），行数与每行长度的上限同 lyricTimedLines
func parseTTMLLyrics(raw string) ttmlLyrics {
	var result ttmlLyrics
	root := parseTTMLTree(raw)
	if root == nil {
		return result
	}
	translations := ttmlKeyedTexts(root)
	romanized := ttmlKeyedRomanizations(root)

	type line struct {
		timed       lyricTimedLine
		translation string
	}
	var lines []line
	walkTTML(root, func(p *ttmlNode) bool {
		if p.name != "p" {
			return true
		}
		begin, beginOK := parseTTMLTime(ttmlAttr(p, "begin"))
		end, endOK := parseTTMLTime(ttmlAttr(p, "end"))
		words, translation, romanization := readTTMLLine(p)
		if len(words) == 0 {
			if text := collapseLyricSpace(ttmlUntimedText(p)); text != "" && beginOK && endOK {
				words = []ttmlWord{{text: text, start: begin, end: end}}
			}
		}
		if key := ttmlAttr(p, "key"); key != "" {
			if translation == "" {
				translation = translations[key]
			}
			romanization = romanization || romanized[key]
		}
		if !beginOK || !endOK || len(words) == 0 {
			return false
		}
		timed, wordTimed, ok := ttmlTimedLine(words, begin, end)
		if !ok {
			return false
		}
		lines = append(lines, line{timed: timed, translation: translation})
		result.HasTranslation = result.HasTranslation || translation != ""
		result.HasRomanization = result.HasRomanization || romanization
		result.WordTimed = result.WordTimed || wordTimed
		return false
	})
	sort.SliceStable(lines, func(a, b int) bool { return lines[a].timed.Start < lines[b].timed.Start })
	if len(lines) > lyricAnnotationMaxLines {
		lines = lines[:lyricAnnotationMaxLines]
	}
	for _, item := range lines {
		result.Lines = append(result.Lines, item.timed)
		result.Translations = append(result.Translations, item.translation)
	}
	return result
}

// ttmlTimedLine 一行的开始时间、文字与长音，以及这一行是否有逐字时间；全是空白时 ok 为 false
func ttmlTimedLine(words []ttmlWord, begin, end int64) (timed lyricTimedLine, wordTimed bool, ok bool) {
	var b strings.Builder
	start, finish := begin, end
	var held *lyricHeldNote
	heldIndex, lastIndex := -1, -1
	for i, word := range words {
		b.WriteString(word.text)
		// AMLL 导出的 00:00.000 占位音节不参与行时间与长音（前端按前后音节补上时间，补出的时长与相邻音节相同）
		if word.start == 0 && word.end == 0 && begin > 0 {
			continue
		}
		start, finish = min(start, word.start), max(finish, word.end)
		if strings.TrimSpace(word.text) == "" {
			continue
		}
		lastIndex = i
		if duration := word.end - word.start; duration >= lyricHeldNoteMs && (held == nil || duration > held.Duration) {
			held, heldIndex = &lyricHeldNote{Text: strings.TrimSpace(word.text), Duration: duration}, i
		}
	}
	text := collapseLyricSpace(b.String())
	if text == "" {
		return timed, false, false
	}
	if held != nil {
		held.Tail = heldIndex == lastIndex
	}
	if runes := []rune(text); len(runes) > lyricAnnotationMaxLineRunes {
		text = string(runes[:lyricAnnotationMaxLineRunes])
	}
	wordTimed = len(words) > 1
	for _, word := range words {
		wordTimed = wordTimed || (word.end > word.start && (word.start != start || word.end != finish))
	}
	return lyricTimedLine{Start: start, Text: text, Held: held}, wordTimed, true
}

// readTTMLLine 一行的音节、翻译（x-translation）与是否有音译（x-roman）；背景人声（x-bg）整个跳过
func readTTMLLine(p *ttmlNode) (words []ttmlWord, translation string, romanization bool) {
	appendText := func(text string) {
		if len(words) > 0 {
			words[len(words)-1].text += text
		}
	}
	for _, child := range p.children {
		if child.name == "" {
			// span 之间的文字：空白作为词间空格挂到前一个音节，其余文字也挂到前一个音节
			if text := child.text; text != "" && strings.TrimSpace(text) == "" {
				appendText(" ")
			} else {
				appendText(text)
			}
			continue
		}
		if child.name != "span" {
			continue
		}
		switch ttmlAttr(child, "role") {
		case "x-translation":
			if translation == "" {
				translation = collapseLyricSpace(ttmlTextContent(child))
			}
			continue
		case "x-roman":
			romanization = romanization || collapseLyricSpace(ttmlTextContent(child)) != ""
			continue
		case "x-bg":
			continue
		}
		start, startOK := parseTTMLTime(ttmlAttr(child, "begin"))
		end, endOK := parseTTMLTime(ttmlAttr(child, "end"))
		if !startOK || !endOK {
			appendText(ttmlTextContent(child))
			continue
		}
		words = append(words, ttmlWord{text: ttmlTextContent(child), start: start, end: max(start, end)})
	}
	return words, translation, romanization
}

// ttmlUntimedText 没有音节时间的行：直接的文字与没有 role 的子元素的文字
func ttmlUntimedText(p *ttmlNode) string {
	var b strings.Builder
	for _, child := range p.children {
		if child.name == "" {
			b.WriteString(child.text)
		} else if ttmlAttr(child, "role") == "" {
			b.WriteString(ttmlTextContent(child))
		}
	}
	return b.String()
}

// ttmlKeyedTexts head 中按 itunes:key 提供的翻译（Apple Music 格式），同一行取第一条
func ttmlKeyedTexts(root *ttmlNode) map[string]string {
	texts := map[string]string{}
	walkTTML(root, func(block *ttmlNode) bool {
		if block.name != "translations" {
			return true
		}
		walkTTML(block, func(text *ttmlNode) bool {
			if text.name != "text" {
				return true
			}
			key, content := ttmlAttr(text, "for"), collapseLyricSpace(ttmlTextContent(text))
			if _, seen := texts[key]; key != "" && content != "" && !seen {
				texts[key] = content
			}
			return false
		})
		return false
	})
	return texts
}

// ttmlKeyedRomanizations head 中按 itunes:key 提供的音译：只算拉丁字母、不含中日韩文字的（只有假名的读音不当音译）
func ttmlKeyedRomanizations(root *ttmlNode) map[string]bool {
	keys := map[string]bool{}
	walkTTML(root, func(block *ttmlNode) bool {
		if block.name != "transliteration" {
			return true
		}
		walkTTML(block, func(text *ttmlNode) bool {
			if text.name != "text" {
				return true
			}
			content := collapseLyricSpace(ttmlTextContent(text))
			if key := ttmlAttr(text, "for"); key != "" && lyricLatinRe.MatchString(content) && !lyricCJKRe.MatchString(content) {
				keys[key] = true
			}
			return false
		})
		return false
	})
	return keys
}

// parseTTMLTree 把 TTML 解析为文档树；不是格式正确的 XML 时返回 nil
func parseTTMLTree(raw string) *ttmlNode {
	decoder := xml.NewDecoder(strings.NewReader(raw))
	root := &ttmlNode{name: "#document"}
	stack := []*ttmlNode{root}
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return root
		}
		if err != nil {
			return nil
		}
		parent := stack[len(stack)-1]
		switch t := token.(type) {
		case xml.StartElement:
			node := &ttmlNode{name: t.Name.Local, attrs: t.Attr}
			parent.children = append(parent.children, node)
			stack = append(stack, node)
		case xml.EndElement:
			if len(stack) > 1 {
				stack = stack[:len(stack)-1]
			}
		case xml.CharData:
			parent.children = append(parent.children, &ttmlNode{text: string(t)})
		}
	}
}

// walkTTML 按文档顺序访问 node 之下的元素；visit 返回 false 时不再进入该元素的子节点
func walkTTML(node *ttmlNode, visit func(*ttmlNode) bool) {
	for _, child := range node.children {
		if child.name != "" && visit(child) {
			walkTTML(child, visit)
		}
	}
}

// ttmlAttr 按本地名读取属性（ttm:role、itunes:key 等带前缀的属性在不同文件中前缀可能不同）
func ttmlAttr(node *ttmlNode, local string) string {
	for _, attr := range node.attrs {
		if attr.Name.Local == local {
			return attr.Value
		}
	}
	return ""
}

// ttmlTextContent 元素之下所有文字
func ttmlTextContent(node *ttmlNode) string {
	if node.name == "" {
		return node.text
	}
	var b strings.Builder
	for _, child := range node.children {
		b.WriteString(ttmlTextContent(child))
	}
	return b.String()
}

// parseTTMLTime TTML 时间：hh:mm:ss.fff / mm:ss.fff / ss.fff / 12.3s / 1234ms，返回毫秒
func parseTTMLTime(value string) (int64, bool) {
	text := strings.TrimSpace(value)
	switch {
	case ttmlMsRe.MatchString(text):
		ms, _ := strconv.ParseFloat(strings.TrimSuffix(text, "ms"), 64)
		return int64(math.Round(ms)), true
	case ttmlSecondsRe.MatchString(text):
		seconds, _ := strconv.ParseFloat(strings.TrimSuffix(text, "s"), 64)
		return int64(math.Round(seconds * 1000)), true
	case ttmlClockRe.MatchString(text):
		total := 0.0
		for _, part := range strings.Split(text, ":") {
			value, _ := strconv.ParseFloat(part, 64)
			total = total*60 + value
		}
		return int64(math.Round(total * 1000)), true
	}
	return 0, false
}

// collapseLyricSpace 合并连续空白并去掉首尾空白
func collapseLyricSpace(text string) string {
	return strings.TrimSpace(whitespaceRe.ReplaceAllString(text, " "))
}
