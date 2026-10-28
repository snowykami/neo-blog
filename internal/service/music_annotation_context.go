package service

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
)

// 歌词标注的上下文（见 docs/music-player-spec.md 7.2b）：除歌词原文外，再给模型歌曲信息、逐行中文翻译与网易云热评，
// 帮助它理解歌曲的背景与情绪。翻译与热评只作参考，不参与歌词文本哈希；热评只在生成时拉取，失败时不带

const (
	// 翻译与原文按时间对齐的容差（毫秒）：逐字歌词与逐行翻译的时间戳常有几百毫秒的偏差
	lyricTranslationTolerance = 1000
	// 给模型挑选的热评条数：尾奏与关键节点的「时刻」都优先用热评
	lyricAnnotationComments = 12
	lyricCommentMaxRunes    = 140
	// 长音：逐字歌词中不短于这个时长（毫秒）的音节在歌词行末标出，供模型设计颤音（shake）。
	// 实测普通音节中位数 0.2～0.4 秒，真正拖长的音多在 1.5～6 秒
	lyricHeldNoteMs = 1500
	// 向其他平台借长音时，行开始时间的容差（毫秒）：各平台的时间轴常有一两秒的偏差，文字还须一致
	lyricHeldBorrowTolerance = 3000
)

var (
	// 行头时间：LRC 的 [mm:ss.xx] 或 YRC / QRC 的 [开始,时长]，取第一个
	lyricLRCTimeRe  = regexp.MustCompile(`^\[(\d+):(\d+)(?:[.:](\d+))?\]`)
	lyricSpanTimeRe = regexp.MustCompile(`^\[(\d+),\d+\]`)
	whitespaceRe    = regexp.MustCompile(`\s+`)
)

// lyricAnnotationInfo 送给模型的上下文；Translations 与歌词行一一对应（没有翻译的行为空字符串），整首没有翻译时为 nil
type lyricAnnotationInfo struct {
	Title        string
	Artists      []string
	Album        string
	Aliases      []string
	Translations []string
	Comments     []lyricAnnotationComment
	// 网易云标出的副歌片段对应的歌词行（副歌起点的参考），生成时根据 Timed 换算
	Chorus []lyricChorusRange
	// 歌词各行的开始时间（与歌词行一一对应）
	Timed []lyricTimedLine
	// 歌词有逐字时间（长音直接从中找出）；没有时在生成时向 QQ 音乐 / 酷狗的逐字歌词借（borrowHeldNotes）
	WordTimed bool
}

// lyricAnnotationComment 一条网易云热评
type lyricAnnotationComment struct {
	Content string
	Liked   int64
}

// lyricTimedLine 歌词的一行：开始时间（毫秒，没有时间时为 -1）与文字
type lyricTimedLine struct {
	Start int64
	Text  string
	// 这一行唱得最长的音节（逐字歌词中不短于 lyricHeldNoteMs 时），没有时为 nil
	Held *lyricHeldNote
}

// lyricHeldNote 一个长音：音节文字、时长（毫秒），以及是否为这一行的最后一个音节（尾音）
type lyricHeldNote struct {
	Text     string
	Duration int64
	Tail     bool
}

// lyricTimedLines 歌词正文（LRC / YRC / QRC）中每一行的开始时间与文字；跳过元信息、无歌词占位与空行，
// maxLines 大于 0 时限制行数，每行长度有上限
func lyricTimedLines(raw string, maxLines int) []lyricTimedLine {
	var lines []lyricTimedLine
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		head := lyricLineHeadRe.FindString(line)
		if head == "" {
			continue
		}
		text := strings.TrimSpace(lyricWordTagRe.ReplaceAllString(line[len(head):], ""))
		if text == "" || text == "no_lyric" || text == "pure_music_without_lyric" {
			continue
		}
		if runes := []rune(text); len(runes) > lyricAnnotationMaxLineRunes {
			text = string(runes[:lyricAnnotationMaxLineRunes])
		}
		lines = append(lines, lyricTimedLine{Start: lyricHeadStart(head), Text: text, Held: lyricHeldNoteOf(line[len(head):])})
		if maxLines > 0 && len(lines) >= maxLines {
			break
		}
	}
	return lines
}

// lyricHeldNoteOf 逐字歌词一行（去掉行头后）中唱得最长的音节，不短于 lyricHeldNoteMs 时返回；
// YRC 的时间标签在字前，QRC 的在字后；逐行歌词没有逐字时间，返回 nil
func lyricHeldNoteOf(body string) *lyricHeldNote {
	tags := lyricWordTagRe.FindAllStringSubmatchIndex(body, -1)
	if len(tags) == 0 {
		return nil
	}
	yrc := tags[0][4] >= 0
	var held *lyricHeldNote
	heldIndex, lastIndex := -1, -1
	for i, tag := range tags {
		var text string
		if yrc {
			end := len(body)
			if i+1 < len(tags) {
				end = tags[i+1][0]
			}
			text = body[tag[1]:end]
		} else {
			start := 0
			if i > 0 {
				start = tags[i-1][1]
			}
			text = body[start:tag[0]]
		}
		if text = strings.TrimSpace(text); text == "" {
			continue
		}
		lastIndex = i
		duration, _ := strconv.ParseInt(body[tag[2]:tag[3]], 10, 64)
		if duration >= lyricHeldNoteMs && (held == nil || duration > held.Duration) {
			held, heldIndex = &lyricHeldNote{Text: text, Duration: duration}, i
		}
	}
	if held != nil {
		held.Tail = heldIndex == lastIndex
	}
	return held
}

// borrowHeldNotes 逐行歌词没有逐字时间：向同一首歌的逐字歌词（QQ 音乐 / 酷狗的 QRC）借长音，
// 开始时间在容差内且文字一致（忽略空白与标点）的行才借（宁缺勿错），歌词文字不变
func borrowHeldNotes(lines []lyricTimedLine, raw string) []lyricTimedLine {
	if strings.TrimSpace(raw) == "" {
		return lines
	}
	source := lyricTimedLines(raw, 0)
	borrowed := slices.Clone(lines)
	for i, line := range borrowed {
		if line.Start < 0 || line.Held != nil {
			continue
		}
		text := normalizeLyricMatch(line.Text)
		for _, other := range source {
			if other.Held != nil && math.Abs(float64(other.Start-line.Start)) <= lyricHeldBorrowTolerance && normalizeLyricMatch(other.Text) == text {
				borrowed[i].Held = other.Held
				break
			}
		}
	}
	return borrowed
}

// lyricHeadStart 行头的开始时间（毫秒）；无法解析时为 -1
func lyricHeadStart(head string) int64 {
	if m := lyricSpanTimeRe.FindStringSubmatch(head); m != nil {
		start, _ := strconv.ParseInt(m[1], 10, 64)
		return start
	}
	m := lyricLRCTimeRe.FindStringSubmatch(head)
	if m == nil {
		return -1
	}
	minutes, _ := strconv.ParseInt(m[1], 10, 64)
	seconds, _ := strconv.ParseInt(m[2], 10, 64)
	ms := int64(0)
	if frac := m[3]; frac != "" {
		// 小数部分按位数换算：.5 → 500、.50 → 500、.500 → 500
		frac = (frac + "000")[:3]
		ms, _ = strconv.ParseInt(frac, 10, 64)
	}
	return (minutes*60+seconds)*1000 + ms
}

// alignLyricTranslations 按开始时间为每行歌词找最接近的翻译（容差内）；没有任何一行对上时返回 nil
func alignLyricTranslations(lines []lyricTimedLine, raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var candidates []lyricTimedLine
	for _, line := range lyricTimedLines(raw, 0) {
		// 网易云用「//」表示这一行没有翻译
		if line.Start >= 0 && line.Text != "//" {
			candidates = append(candidates, line)
		}
	}
	result := make([]string, len(lines))
	found := false
	for i, line := range lines {
		if line.Start < 0 {
			continue
		}
		best, bestDiff := "", int64(math.MaxInt64)
		for _, candidate := range candidates {
			diff := candidate.Start - line.Start
			if diff < 0 {
				diff = -diff
			}
			if diff < bestDiff {
				best, bestDiff = candidate.Text, diff
			}
		}
		if bestDiff <= lyricTranslationTolerance && best != line.Text {
			result[i] = best
			found = true
		}
	}
	if !found {
		return nil
	}
	return result
}

// lyricTranslationSource 与所选歌词来源对应的翻译：网易云逐字歌词优先用逐字翻译，否则用逐行翻译
func lyricTranslationSource(lyric *dto.MusicLyricDto, wordTimed bool) string {
	if wordTimed && lyric.Ytlrc != nil && strings.TrimSpace(lyric.Ytlrc.Lyric) != "" {
		return lyric.Ytlrc.Lyric
	}
	if lyric.Tlyric != nil {
		return lyric.Tlyric.Lyric
	}
	return ""
}

// fetchNCMHotComments 网易云热评（按点赞数取前几条），只在生成标注时调用；未配置 API 或请求失败时返回 nil
func fetchNCMHotComments(ctx context.Context, id int64) []lyricAnnotationComment {
	cfg := tools.GetNCMConfig()
	if !validMusicAPIBaseURL(cfg.BaseURL) {
		return nil
	}
	var raw struct {
		HotComments []struct {
			Content    string `json:"content"`
			LikedCount int64  `json:"likedCount"`
		} `json:"hotComments"`
	}
	// 多取一些：过滤掉灌水与广告后仍有足够的评论给模型挑
	params := url.Values{"id": {strconv.FormatInt(id, 10)}, "type": {"0"}, "limit": {"50"}}
	// 热评不需要登录，不携带 Cookie
	if err := ncmGet(ctx, tools.NCMConfig{BaseURL: cfg.BaseURL}, "/comment/hot", params, &raw); err != nil {
		return nil
	}
	comments := make([]lyricAnnotationComment, 0, len(raw.HotComments))
	for _, item := range raw.HotComments {
		comments = append(comments, lyricAnnotationComment{Content: item.Content, Liked: item.LikedCount})
	}
	return pickHotComments(comments)
}

// pickHotComments 按点赞数从高到低取前几条：合并空白、截断过长的评论，过滤灌水与广告（见 isLowQualityComment）
func pickHotComments(comments []lyricAnnotationComment) []lyricAnnotationComment {
	var picked []lyricAnnotationComment
	for _, comment := range comments {
		content := strings.TrimSpace(whitespaceRe.ReplaceAllString(comment.Content, " "))
		if isLowQualityComment(content) {
			continue
		}
		if utf8.RuneCountInString(content) > lyricCommentMaxRunes {
			content = string([]rune(content)[:lyricCommentMaxRunes]) + "…"
		}
		picked = append(picked, lyricAnnotationComment{Content: content, Liked: comment.Liked})
	}
	sort.SliceStable(picked, func(i, j int) bool { return picked[i].Liked > picked[j].Liked })
	if len(picked) > lyricAnnotationComments {
		picked = picked[:lyricAnnotationComments]
	}
	return picked
}

var (
	// 网易云表情（[大哭]）、@某人
	commentEmojiRe   = regexp.MustCompile(`\[[^\[\]]{1,6}\]`)
	commentMentionRe = regexp.MustCompile(`@\S+`)
	// 笑声与刷屏：哈哈哈、hhh、233、666
	commentLaughRe = regexp.MustCompile(`(?i)(哈{2,}|呵{2,}|嘿{2,}|h{3,}|2{1}3{2,}|6{3,})`)
	// 广告、引流与链接：出现即过滤
	commentAdRe = regexp.MustCompile(`(?i)(https?://|www\.|微信|v信|vx|加群|qq群|关注我|私信我|代刷|淘宝|招租|广告|推广|兼职)`)
	// 抢楼、打卡等灌水：评论较短时过滤
	commentSpamRe = regexp.MustCompile(`(前排|沙发|板凳|地板|打卡|签到|第[一1]个?|来了来了|路过|留名|考古|有人吗|顶顶|楼主|冲冲冲|mark)`)
)

// 去掉表情与 @ 后至少这么多字才有内容；灌水词只在评论短于 commentSpamMaxRunes 时过滤
const (
	commentMinRunes     = 6
	commentSpamMaxRunes = 20
)

// isLowQualityComment 是否为灌水、刷屏或广告评论：这些评论不交给模型，也就不会出现在时刻与尾奏中
func isLowQualityComment(content string) bool {
	if commentAdRe.MatchString(content) {
		return true
	}
	text := strings.TrimSpace(commentMentionRe.ReplaceAllString(commentEmojiRe.ReplaceAllString(content, ""), ""))
	runes := []rune(strings.Join(strings.Fields(text), ""))
	if len(runes) < commentMinRunes {
		return true
	}
	// 几乎只由一两种字组成（啊啊啊啊、。。。。）
	distinct := map[rune]bool{}
	for _, r := range runes {
		distinct[r] = true
	}
	if len(distinct) <= 2 {
		return true
	}
	// 笑声、刷屏占了大半
	laugh := 0
	for _, match := range commentLaughRe.FindAllString(text, -1) {
		laugh += utf8.RuneCountInString(match)
	}
	if laugh*2 >= len(runes) {
		return true
	}
	return len(runes) < commentSpamMaxRunes && commentSpamRe.MatchString(strings.ToLower(text))
}

// buildLyricAnnotationPrompt 全曲规划的用户消息：歌曲信息、热评（低可信度参考）、网易云副歌片段与带行号的完整歌词
func buildLyricAnnotationPrompt(info lyricAnnotationInfo, lines []string) string {
	text := lyricAnnotationText
	var b strings.Builder
	writeLyricAnnotationSong(&b, info, true)
	if len(info.Comments) > 0 {
		b.WriteString(text.Comments)
		for i, comment := range info.Comments {
			fmt.Fprintf(&b, text.Comment, i+1, comment.Content, comment.Liked)
		}
	}
	if len(info.Chorus) > 0 {
		b.WriteString(text.Chorus)
		for _, chorus := range info.Chorus {
			fmt.Fprintf(&b, text.ChorusRange, chorus.From, chorus.To, formatLyricTime(chorus.Start), formatLyricTime(chorus.End))
		}
	}
	writeLyricAnnotationLines(&b, info, lines, 0, len(lines)-1)
	return b.String()
}

// writeLyricAnnotationSong 歌曲信息：歌名、歌手、（全曲规划时）专辑与别名 / 描述
func writeLyricAnnotationSong(b *strings.Builder, info lyricAnnotationInfo, album bool) {
	text := lyricAnnotationText
	b.WriteString(text.SongInfo)
	if info.Title != "" {
		b.WriteString(text.Title + info.Title + "\n")
	}
	if len(info.Artists) > 0 {
		b.WriteString(text.Artists + strings.Join(info.Artists, " / ") + "\n")
	}
	if album && info.Album != "" {
		b.WriteString(text.Album + info.Album + "\n")
	}
	if len(info.Aliases) > 0 {
		b.WriteString(text.Aliases + strings.Join(info.Aliases, "; ") + "\n")
	}
}

// writeLyricAnnotationLines 带行号的歌词（第 from～to 行，行号为全曲行号）：有翻译时在行末附上翻译，逐字歌词中唱得特别长的音节附上长音标记
func writeLyricAnnotationLines(b *strings.Builder, info lyricAnnotationInfo, lines []string, from, to int) {
	text := lyricAnnotationText
	from, to = max(0, from), min(len(lines)-1, to)
	held := func(i int) *lyricHeldNote {
		if i < len(info.Timed) {
			return info.Timed[i].Held
		}
		return nil
	}
	hasTranslation, hasHeld := false, false
	for i := from; i <= to; i++ {
		hasTranslation = hasTranslation || (i < len(info.Translations) && info.Translations[i] != "")
		hasHeld = hasHeld || held(i) != nil
	}
	b.WriteString(text.Lyrics)
	if hasTranslation {
		b.WriteString(text.TranslationNote)
	}
	if hasHeld {
		b.WriteString(text.HeldNote)
	}
	b.WriteString("\n")
	for i := from; i <= to; i++ {
		fmt.Fprintf(b, "%d: %s", i, lines[i])
		if i < len(info.Translations) && info.Translations[i] != "" {
			fmt.Fprintf(b, text.Translation, info.Translations[i])
		}
		if note := held(i); note != nil {
			tail := ""
			if note.Tail {
				tail = text.HeldTail
			}
			fmt.Fprintf(b, text.Held, note.Text, float64(note.Duration)/1000, tail)
		}
		b.WriteString("\n")
	}
}

// formatLyricTime 毫秒 → m:ss
func formatLyricTime(ms int64) string {
	return fmt.Sprintf("%d:%02d", ms/60000, ms/1000%60)
}
