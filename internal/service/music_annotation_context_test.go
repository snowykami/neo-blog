package service

import (
	"reflect"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
)

func TestLyricHeadStart(t *testing.T) {
	cases := map[string]int64{
		"[01:02.5]":   62500,
		"[01:02.50]":  62500,
		"[01:02.500]": 62500,
		"[00:03]":     3000,
		"[1500,800]":  1500,
		"[ti:歌名]":     -1,
		"[00:01:20]":  1200,
		"[02:00.05][": 120050,
	}
	for head, want := range cases {
		if got := lyricHeadStart(head); got != want {
			t.Errorf("lyricHeadStart(%q) = %d, want %d", head, got, want)
		}
	}
}

func TestAlignLyricTranslations(t *testing.T) {
	// 逐字歌词的开始时间与逐行翻译相差几百毫秒；「//」为没有翻译
	lines := lyricTimedLines("[1000,800](1000,400,0)Hello\n[4000,800](4000,400,0)Bye\n[9000,500](9000,500,0)La", 0)
	got := alignLyricTranslations(lines, "[00:01.30]你好\n[00:04.00]//\n[00:20.00]远处的翻译")
	if want := []string{"你好", "", ""}; !reflect.DeepEqual(got, want) {
		t.Fatalf("translations = %q, want %q", got, want)
	}
	if got := alignLyricTranslations(lines, ""); got != nil {
		t.Fatalf("empty translation = %q", got)
	}
	if got := alignLyricTranslations(lines, "[00:30.00]对不上"); got != nil {
		t.Fatalf("unmatched translation = %q", got)
	}
}

func TestLyricTranslationSource(t *testing.T) {
	lyric := &dto.MusicLyricDto{Tlyric: &dto.MusicLyricPart{Lyric: "逐行"}, Ytlrc: &dto.MusicLyricPart{Lyric: "逐字"}}
	if got := lyricTranslationSource(lyric, true); got != "逐字" {
		t.Fatalf("word timed = %q", got)
	}
	if got := lyricTranslationSource(lyric, false); got != "逐行" {
		t.Fatalf("line timed = %q", got)
	}
}

func TestPickHotComments(t *testing.T) {
	long := strings.Repeat("长", lyricCommentMaxRunes+10)
	comments := []lyricAnnotationComment{
		{Content: "一般", Liked: 10}, {Content: "  ", Liked: 999}, {Content: "最热\n的评论", Liked: 500},
		{Content: long, Liked: 300}, {Content: "a", Liked: 1}, {Content: "b", Liked: 2}, {Content: "c", Liked: 3},
	}
	for i := 0; i < lyricAnnotationComments; i++ {
		comments = append(comments, lyricAnnotationComment{Content: "凑数", Liked: 0})
	}
	got := pickHotComments(comments)
	if len(got) != lyricAnnotationComments || got[0].Content != "最热 的评论" || got[1].Liked != 300 {
		t.Fatalf("picked = %+v", got)
	}
	if !strings.HasSuffix(got[1].Content, "…") || len([]rune(got[1].Content)) != lyricCommentMaxRunes+1 {
		t.Fatalf("long comment not truncated: %q", got[1].Content)
	}
}

func TestBuildLyricAnnotationPrompt(t *testing.T) {
	info := lyricAnnotationInfo{
		Title: "紫荆花盛开", Artists: []string{"李荣浩", "梁咏琪"}, Album: "紫荆花盛开", Aliases: []string{"香港回归25周年纪念"},
		Translations: []string{"", "你好"},
		Comments:     []lyricAnnotationComment{{Content: "泪目", Liked: 100}},
	}
	prompt := buildLyricAnnotationPrompt(info, []string{"紫荆花飘扬", "Hello"})
	for _, want := range []string{"歌名：紫荆花盛开", "歌手：李荣浩 / 梁咏琪", "别名 / 描述：香港回归25周年纪念", "1. 泪目（100 赞）", "0: 紫荆花飘扬\n", "1: Hello　〔译：你好〕\n", "只能取自原文"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
	// 没有热评与翻译时不出现对应段落
	plain := buildLyricAnnotationPrompt(lyricAnnotationInfo{Title: "歌"}, []string{"晴天"})
	if strings.Contains(plain, "听众热评") || strings.Contains(plain, "〔译") {
		t.Fatalf("plain prompt = %s", plain)
	}
}

func TestChorusLineRanges(t *testing.T) {
	lines := []lyricTimedLine{{Start: 1000}, {Start: 20000}, {Start: 34000}, {Start: 40000}, {Start: 60000}, {Start: 70000}}
	got := chorusLineRanges(lines, []dto.MusicChorusDto{{Start: 34500, End: 61000}, {Start: 200000, End: 210000}})
	// 第二段附近 3 秒内没有歌词行，不换算
	if want := []lyricChorusRange{{From: 2, To: 4, Start: 34500, End: 61000}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ranges = %+v", got)
	}
	prompt := buildLyricAnnotationPrompt(lyricAnnotationInfo{Chorus: got}, []string{"a"})
	if !strings.Contains(prompt, "第 2 行～第 4 行（0:34～1:01）") {
		t.Fatalf("prompt = %s", prompt)
	}
}
