package service

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"regexp"
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
	lyricAnnotationComments   = 5
	lyricCommentMaxRunes      = 140
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
		lines = append(lines, lyricTimedLine{Start: lyricHeadStart(head), Text: text})
		if maxLines > 0 && len(lines) >= maxLines {
			break
		}
	}
	return lines
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
	params := url.Values{"id": {strconv.FormatInt(id, 10)}, "type": {"0"}, "limit": {"20"}}
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

// pickHotComments 按点赞数从高到低取前几条：合并空白、截断过长的评论，去掉空评论
func pickHotComments(comments []lyricAnnotationComment) []lyricAnnotationComment {
	var picked []lyricAnnotationComment
	for _, comment := range comments {
		content := strings.TrimSpace(whitespaceRe.ReplaceAllString(comment.Content, " "))
		if content == "" {
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

// buildLyricAnnotationPrompt 用户消息：歌曲信息、热评（低可信度参考）与带行号的歌词（有翻译时附在行末）
func buildLyricAnnotationPrompt(info lyricAnnotationInfo, lines []string) string {
	var b strings.Builder
	b.WriteString("【歌曲信息】\n")
	if info.Title != "" {
		b.WriteString("歌名：" + info.Title + "\n")
	}
	if len(info.Artists) > 0 {
		b.WriteString("歌手：" + strings.Join(info.Artists, " / ") + "\n")
	}
	if info.Album != "" {
		b.WriteString("专辑：" + info.Album + "\n")
	}
	if len(info.Aliases) > 0 {
		b.WriteString("别名 / 描述：" + strings.Join(info.Aliases, "；") + "\n")
	}
	if len(info.Comments) > 0 {
		b.WriteString("\n【听众热评】（来自网易云的普通听众，只用来感受这首歌在听众心中的情绪与故事；可信度有限，玩笑、广告或与歌曲无关的评论请直接忽略）\n")
		for i, comment := range info.Comments {
			fmt.Fprintf(&b, "%d. %s（%d 赞）\n", i+1, comment.Content, comment.Liked)
		}
	}
	b.WriteString("\n【歌词】")
	if info.Translations != nil {
		b.WriteString("（外语歌词在行末用〔译：…〕附上中文翻译，只帮助你理解含义；phrases 的 text 只能取自原文，不能取自翻译）")
	}
	b.WriteString("\n")
	for i, line := range lines {
		fmt.Fprintf(&b, "%d: %s", i, line)
		if i < len(info.Translations) && info.Translations[i] != "" {
			b.WriteString("　〔译：" + info.Translations[i] + "〕")
		}
		b.WriteString("\n")
	}
	return b.String()
}
