package service

import (
	"reflect"
	"strings"
	"testing"
)

// 逐字歌词的一行：开始、结束（毫秒）与文字
func structLine(start, end int64, text string) lyricTimedLine {
	return lyricTimedLine{Start: start, End: end, Text: text}
}

func TestLyricStructureOf(t *testing.T) {
	lines := []lyricTimedLine{
		structLine(0, 900, "晴天 - 周杰伦"), // 署名行：不算唱的时间，前奏从第一句歌词算起
		structLine(1000, 1900, "词：周杰伦"),
		structLine(20000, 23000, "故事的小黄花"),
		structLine(23500, 26000, "从出生那年就飘着"),
		structLine(26100, 29000, "刮风这天 我试过握着你手"), // 副歌第一次
		structLine(29100, 32000, "但偏偏 雨渐渐"),
		structLine(39600, 42000, "刮风这天，我试过握着你手"), // 与上一句空 7.6 秒：间奏；标点不同仍算重复
		structLine(42100, 45000, "但偏偏雨渐渐"),
		structLine(52500, 55000, "啊"), // 与上一句空 7.5 秒：不到间奏；单字语气词不算重复
		structLine(55100, 58000, "啊"),
	}
	info := lyricAnnotationInfo{Title: "晴天", Artists: []string{"周杰伦"}, Source: "ncm-yrc", Timed: lines, Duration: 70000}
	got := lyricStructureOf(info)
	if want := []bool{true, true, false, false, false, false, false, false, false, false}; !reflect.DeepEqual(got.Credit, want) {
		t.Fatalf("credit = %v", got.Credit)
	}
	if want := []int{0, 0, 0, 0, 1, 2, 1, 2, 0, 0}; !reflect.DeepEqual(got.Repeat, want) {
		t.Fatalf("repeat = %v", got.Repeat)
	}
	if want := []int64{0, 0, 20000, 0, 0, 0, 7600, 0, 0, 0}; !reflect.DeepEqual(got.GapBefore, want) {
		t.Fatalf("gaps = %v", got.GapBefore)
	}
	if got.Outro != 12000 {
		t.Fatalf("outro = %d", got.Outro)
	}

	// TTML 不去署名行；背景人声填在空隙里时不算间奏（前端把背景人声显示为单独的一行）
	ttml := lyricAnnotationInfo{Source: "ttml-amll", Timed: []lyricTimedLine{
		structLine(0, 2000, "作词：某人"),
		{Start: 3000, End: 5000, Text: "第一句", Background: &lyricBackground{Text: "(oh)", Start: 8000, End: 10000}},
		structLine(15000, 17000, "第二句"),
	}}
	got = lyricStructureOf(ttml)
	if got.Credit[0] || got.GapBefore[1] != 0 || got.GapBefore[2] != 0 || got.Outro != 0 {
		t.Fatalf("ttml structure = %+v", got)
	}
}

func TestLyricCreditRange(t *testing.T) {
	for _, text := range []string{"作词 : 宇多田ヒカル", "曲：某人", "Producer: Someone", "Lyrics by Someone", "未经许可，不得翻唱或使用"} {
		if !isLyricCreditText(text) {
			t.Errorf("%q should be a credit", text)
		}
	}
	for _, text := range []string{"愛：それはきっと", "初めてのルーブルは"} {
		if isLyricCreditText(text) {
			t.Errorf("%q should not be a credit", text)
		}
	}
	// 只去掉首尾连续的署名，歌名单独成行只在开头去掉（与前端 lyrics.test.ts 的用例相同）
	texts := []string{"One Last Kiss", "宇多田ヒカル", "作词：甲", "第一句", "作词：乙", "第二句", "One Last Kiss", "制作人：丙"}
	if head, tail := lyricCreditRange(texts, "One Last Kiss", []string{"宇多田ヒカル"}); head != 3 || tail != 7 {
		t.Errorf("range = [%d, %d)", head, tail)
	}
	texts = []string{"晴天 - 周杰伦 (Jay Chou)", "词：周杰伦", "编曲：周杰伦", "制作人：周杰伦", "合声：周杰伦", "合声编写：周杰伦", "吉他：某人", "鼓：某人", "录音助理：某人", "混音工程：某人（某工作室）", "故事的小黄花"}
	if head, tail := lyricCreditRange(texts, "晴天", []string{"周杰伦"}); head != 10 || tail != 11 {
		t.Errorf("long credits range = [%d, %d)", head, tail)
	}
	// 不会把所有行都去掉
	if head, tail := lyricCreditRange([]string{"作词：甲", "作曲：乙"}, "", nil); head != 0 || tail != 2 {
		t.Errorf("all credits range = [%d, %d)", head, tail)
	}
}

// 对唱：与前端 parse-ttml.ts 一致，第一个不是群组的 agent 为主唱，其余为第二位歌手，多个 agent 或群组为合唱
const duetTTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/><ttm:agent type="group" xml:id="v3"/></metadata></head>
<body><div>
<p begin="00:01.000" end="00:03.000" ttm:agent="v1"><span begin="00:01.000" end="00:03.000">我先唱</span></p>
<p begin="00:03.000" end="00:05.000" ttm:agent="v2"><span begin="00:03.000" end="00:05.000">我接着唱</span></p>
<p begin="00:05.000" end="00:07.000" ttm:agent="v3"><span begin="00:05.000" end="00:07.000">一起唱</span></p>
<p begin="00:07.000" end="00:09.000" ttm:agent="v1 v2"><span begin="00:07.000" end="00:09.000">还是一起</span></p>
</div></body></tt>`

func TestTTMLSingers(t *testing.T) {
	parsed := parseTTMLLyrics(duetTTML)
	var singers []string
	for _, line := range parsed.Lines {
		singers = append(singers, line.Singer)
	}
	if want := []string{"", lyricSingerSecond, lyricSingerTogether, lyricSingerTogether}; !reflect.DeepEqual(singers, want) {
		t.Fatalf("singers = %q", singers)
	}
}

func TestLyricStructurePrompt(t *testing.T) {
	lines := []lyricTimedLine{
		structLine(0, 900, "作词：某人"),
		structLine(10000, 12500, "你好"),
		{Start: 13000, End: 15000, Text: "再见", Singer: lyricSingerSecond, Background: &lyricBackground{Text: "(再见)", Start: 14000, End: 15000}},
		structLine(30000, 32500, "你好"),
	}
	texts := []string{"作词：某人", "你好", "再见", "你好"}
	info := lyricAnnotationInfo{Source: "ncm-yrc", Timed: lines, Duration: 50000}
	prompt := buildLyricAnnotationPrompt(info, texts)
	for _, part := range []string{
		"0: 作词：某人　〔credits〕\n",
		"〔intro: 10s〕\n1: 你好　〔2.5s〕　〔repeat 1〕\n",
		"2: 再见　〔2.0s〕　〔singer 2〕　〔bg: \"(再见)\"〕\n",
		"〔instrumental break: 15s〕\n3: 你好　〔2.5s〕　〔repeat 1〕\n",
		"〔outro: 18s〕\n</lyrics>",
		"〔credits〕: a credit line", "〔repeat N〕:", "〔singer 2〕 / 〔together〕:", "〔bg: …〕:", "intro / instrumental break / outro",
	} {
		if !strings.Contains(prompt, part) {
			t.Errorf("prompt missing %q:\n%s", part, prompt)
		}
	}
	// 逐段标注只写本段的行：本段之前的间奏照样标出，尾奏只在最后一段
	chunk := &strings.Builder{}
	writeLyricAnnotationLines(chunk, info, texts, 2, 3)
	if got := chunk.String(); !strings.Contains(got, "〔instrumental break: 15s〕\n3:") || !strings.Contains(got, "〔outro: 18s〕") || strings.Contains(got, "〔intro: ") {
		t.Errorf("chunk = %s", got)
	}
	chunk.Reset()
	writeLyricAnnotationLines(chunk, info, texts, 0, 1)
	if got := chunk.String(); !strings.Contains(got, "〔intro: 10s〕\n1:") || strings.Contains(got, "〔outro: ") || strings.Contains(got, "〔singer 2〕") {
		t.Errorf("first chunk = %s", got)
	}
}

// 近似重复：再唱时换了一两个词的行归入同一组并标为有变化；太短的行与署名样式的行不参与近似比较
func TestLyricRepeatGroupsVaried(t *testing.T) {
	texts := []string{
		"あぁこのまま僕ら世界から", // 0
		"あぁこのまま僕が世界から", // 1：换了一个字，近似
		"あぁこのまま僕ら世界から", // 2：与 0 完全相同
		"まったく違う一行の歌詞",  // 3：不相似
		"曲：d0tc0mmie",  // 4：署名样式，不做近似比较
		"编曲：d0tc0mmie", // 5
		"天国 天国",        // 6：太短，不做近似比较
		"天国 天国 天国",     // 7
	}
	lines := make([]lyricTimedLine, len(texts))
	for i, text := range texts {
		lines[i] = lyricTimedLine{Text: text}
	}
	groups, varied := lyricRepeatGroups(lines, make([]bool, len(lines)))
	if want := []int{1, 1, 1, 0, 0, 0, 0, 0}; !reflect.DeepEqual(groups, want) {
		t.Fatalf("groups = %v", groups)
	}
	if want := []bool{false, true, false, false, false, false, false, false}; !reflect.DeepEqual(varied, want) {
		t.Fatalf("varied = %v", varied)
	}
	if got := lyricSimilarity([]rune("abcdefghij"), []rune("abcdefghiX")); got < 0.89 || got > 0.91 {
		t.Fatalf("similarity = %v", got)
	}
	if got := lyricSimilarity([]rune("abcdefghij"), []rune("abc")); got != 0 {
		t.Fatalf("length mismatch similarity = %v", got)
	}
}
