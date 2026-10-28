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
	long := strings.Repeat("长句子", lyricCommentMaxRunes)
	comments := []lyricAnnotationComment{
		{Content: "一般般吧还行", Liked: 10}, {Content: "  ", Liked: 999}, {Content: "最热\n的评论，听哭了好多次", Liked: 500},
		{Content: long, Liked: 300}, {Content: "哈哈哈前排", Liked: 400}, {Content: "广告位招租", Liked: 450},
	}
	for i := 0; i < lyricAnnotationComments; i++ {
		comments = append(comments, lyricAnnotationComment{Content: "这首歌陪我度过了很多夜晚", Liked: 0})
	}
	got := pickHotComments(comments)
	// 空评论、灌水与广告被过滤；按点赞排序并截断过长的评论
	if len(got) != lyricAnnotationComments || got[0].Content != "最热 的评论，听哭了好多次" || got[1].Liked != 300 || got[2].Liked != 10 {
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
	for _, want := range []string{"Title: 紫荆花盛开", "Artists: 李荣浩 / 梁咏琪", "Aliases / description: 香港回归25周年纪念", "1. 泪目 (100 likes)", "0: 紫荆花飘扬\n", "1: Hello　〔译：你好〕\n", "is a Chinese translation"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
	// 没有热评与翻译时不出现对应段落
	plain := buildLyricAnnotationPrompt(lyricAnnotationInfo{Title: "歌"}, []string{"晴天"})
	if strings.Contains(plain, "Listener comments") || strings.Contains(plain, "〔译") {
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
	// 高潮片段标在歌词行末：第一行标开始，最后一行标结束（全曲规划与逐段标注都能看到）
	lines6 := []string{"a", "b", "c", "d", "e", "f"}
	prompt := buildLyricAnnotationPrompt(lyricAnnotationInfo{Chorus: got}, lines6)
	for _, want := range []string{"2: c　〔climax starts〕\n", "3: d\n", "4: e　〔climax ends〕\n"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
	chunk := buildLyricAnnotationLinesPrompt(lyricAnnotationInfo{Chorus: got}, lines6, lyricAnnotationPlan{}, 3, 5, 2)
	if !strings.Contains(chunk, "4: e　〔climax ends〕") {
		t.Fatalf("chunk prompt = %s", chunk)
	}
}

func TestIsLowQualityComment(t *testing.T) {
	junk := []string{
		"哈哈哈前排", "广告位招租", "前排打卡", "沙发！", "哈哈哈哈哈哈哈哈哈哈好听", "啊啊啊啊啊啊啊啊", "[大哭][大哭][大哭]",
		"@某某某 你听", "加微信看更多", "https://example.com 好听", "hhhhhhhhh笑死", "第一个听的来了来了", "666666666",
	}
	for _, content := range junk {
		if !isLowQualityComment(content) {
			t.Errorf("%q should be filtered", content)
		}
	}
	good := []string{
		"每次加班到深夜，回家路上都会听这首，好像有人在说：辛苦了。",
		"那年夏天我们都在，后来只剩我一个人听这首歌",
		"前排说一句：这首歌陪我走过了最难的那一年，谢谢你。",
		"哈哈，第一次听哭了，想起了外婆家门口的那棵紫荆花树",
	}
	for _, content := range good {
		if isLowQualityComment(content) {
			t.Errorf("%q should be kept", content)
		}
	}
}

func TestLyricHeldNotes(t *testing.T) {
	raw := strings.Join([]string{
		// YRC：标签在字前；尾音「た」拖了 2.1 秒
		"[1000,4000](1000,300,0)連(1300,300,0)れ(1600,300,0)出(1900,300,0)し(2200,2100,0)た",
		// QRC：标签在字后；最长的「啦」在句中，不是尾音
		"[5000,6000]啦(5000,3500)啦(8500,400)啦(8900,300)",
		// 没有足够长的音节
		"[12000,1000](12000,500,0)短(12500,500,0)句",
		// 英文吟唱：空格不算音节，Ahh 是尾音
		"[14000,3000](14000,400,0)Oh (14400,2600,0)Ahh",
		// 逐行歌词没有逐字时间
		"[00:20.00]逐行歌词",
	}, "\n")
	lines := lyricTimedLines(raw, 0)
	want := []*lyricHeldNote{
		{Text: "た", Duration: 2100, Tail: true},
		{Text: "啦", Duration: 3500, Tail: false},
		nil,
		{Text: "Ahh", Duration: 2600, Tail: true},
		nil,
	}
	if len(lines) != len(want) {
		t.Fatalf("lines = %+v", lines)
	}
	for i, line := range lines {
		if !reflect.DeepEqual(line.Held, want[i]) {
			t.Errorf("line %d (%s): held = %+v, want %+v", i, line.Text, line.Held, want[i])
		}
	}
	if lines[0].Text != "連れ出した" || lines[1].Text != "啦啦啦" {
		t.Errorf("text = %q, %q", lines[0].Text, lines[1].Text)
	}

	// 用户消息中在行末标出长音
	prompt := buildLyricAnnotationPrompt(lyricAnnotationInfo{Timed: lines}, []string{lines[0].Text, lines[1].Text, lines[2].Text})
	for _, part := range []string{"marks a long-held syllable", "0: 連れ出した　〔held: \"た\" 2.1s, line end〕", "1: 啦啦啦　〔held: \"啦\" 3.5s〕", "2: 短句\n"} {
		if !strings.Contains(prompt, part) {
			t.Errorf("prompt missing %q:\n%s", part, prompt)
		}
	}
}

func TestBorrowHeldNotes(t *testing.T) {
	lines := lyricTimedLines("[00:01.00]連れ出した\n[00:06.00]啦啦啦\n[00:20.00]别的歌词", 0)
	qrc := strings.Join([]string{
		// 时间轴相差 0.8 秒、文字一致（忽略空白）：借
		"[1800,4000]連(1800,300)れ(2100,300)出(2400,300)し(2700,300)た(3000,2100)",
		// 文字不同：不借
		"[6000,6000]啦(6000,3500)啦(9500,400)",
		// 时间相差太远：不借
		"[40000,3000]别(40000,300)的(40300,300)歌(40600,300)词(40900,2000)",
	}, "\n")
	borrowed := borrowHeldNotes(lines, qrc)
	if got := borrowed[0].Held; got == nil || got.Text != "た" || !got.Tail {
		t.Errorf("line 0 held = %+v", got)
	}
	if borrowed[1].Held != nil || borrowed[2].Held != nil {
		t.Errorf("should not borrow: %+v, %+v", borrowed[1].Held, borrowed[2].Held)
	}
	if lines[0].Held != nil || borrowed[0].Text != "連れ出した" {
		t.Error("borrowing must not change the original lines or text")
	}
	if got := borrowHeldNotes(lines, ""); !reflect.DeepEqual(got, lines) {
		t.Error("no word-timed lyric: unchanged")
	}
}
