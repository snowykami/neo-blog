package service

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
)

func TestLyricTextLines(t *testing.T) {
	raw := "{\"t\":0,\"c\":[{\"tx\":\"作词: \"}]}\n" +
		"[ti:歌]\n" +
		"[00:01.00][00:30.00]你好\n" +
		"[1000,1000](1000,500,0)再(1500,500,0)见\n" +
		"[2000,800]晴(2000,400)天(2400,400)\n" +
		"[00:03.00]\n" +
		"[00:00.00]no_lyric"
	want := []string{"你好", "再见", "晴天"}
	if got := lyricTextLines(raw); !reflect.DeepEqual(got, want) {
		t.Fatalf("lines = %q, want %q", got, want)
	}
}

func TestSanitizeLyricAnnotations(t *testing.T) {
	lines := []string{"图书馆邻座女孩偏怦然心动", "Say I love you", "图书馆邻座女孩偏怦然心动", "作词：某人"}
	raw := "```json\n" + `{"theme":"暗恋","direction":"粉色为主","font":"song","lines":[
		{"i":0,"mood":"bright","chorus":true,"phrases":[{"text":"怦然心动","effect":"glow","color":"pink"},{"text":"不存在的词","effect":"swell"},{"text":"女孩","effect":"bogus","color":"#ff0000","font":"kai","styles":["bold","blink","bold"]},{"text":"图书馆","effect":"wave","font":"comic"},{"text":"邻座","effect":"wave"}]},
		{"i":1,"mood":"angry","chorus_start":true,"scene":"petals","scene_color":"pink","phrases":[{"text":"I LOVE you!","effect":"shake","color":"starry-blue","styles":["strike","underline"]}]},
		{"i":2,"phrases":[{"text":"怦然心动","effect":"swell"}]},
		{"i":9,"phrases":[{"text":"x","effect":"swell"}]},
		{"i":3,"mood":"","scene":"tornado","phrases":[]}
	]}` + "\n```"
	got, err := sanitizeLyricAnnotations(lines, nil, raw)
	if err != nil {
		t.Fatal(err)
	}
	want := lyricAnnotationData{Font: "song", Lines: []dto.MusicLyricAnnotationLine{
		// 同一文本的两行合并；不在原文中的短语丢弃；未知特效改为 swell、旧版颜色名映射到新色板、未知颜色丢弃；
		// 未知字体与字形丢弃、重复的字形去重；每行最多 3 个短语，重复的短语不再加入
		{Text: lines[0], Mood: "bright", Chorus: true, Phrases: []dto.MusicLyricAnnotationPhrase{
			{Text: "怦然心动", Effect: "glow", Color: "cherry-blossom"},
			{Text: "女孩", Effect: "swell", Font: "kai", Styles: []string{"bold"}},
			{Text: "图书馆", Effect: "wave"},
		}},
		// 忽略大小写与标点匹配原文；未知情绪丢弃；副歌起点同时是副歌行；未知场景（第 4 行的 tornado）丢弃，该行没有其他标注而被去掉
		{Text: lines[1], Chorus: true, ChorusStart: true, Scene: "petals", SceneColor: "cherry-blossom", Phrases: []dto.MusicLyricAnnotationPhrase{
			{Text: "I LOVE you!", Effect: "shake", Color: "starry-blue", Styles: []string{"strike", "underline"}},
		}},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("annotations = %+v\nwant %+v", got, want)
	}
	if _, err := sanitizeLyricAnnotations(lines, nil, "抱歉，我无法完成"); err == nil {
		t.Fatal("non-json response should fail")
	}
}

func TestParseLyricAnnotationData(t *testing.T) {
	// 旧版记录只有 lines 数组
	legacy := parseLyricAnnotationData(`[{"text":"晴天","phrases":[]}]`)
	if legacy.Font != "" || len(legacy.Lines) != 1 || legacy.Lines[0].Text != "晴天" {
		t.Fatalf("legacy = %+v", legacy)
	}
	current := parseLyricAnnotationData(`{"font":"kai","lines":[{"text":"晴天","phrases":[]}]}`)
	if current.Font != "kai" || len(current.Lines) != 1 {
		t.Fatalf("current = %+v", current)
	}
	if broken := parseLyricAnnotationData("oops"); broken.Lines == nil || len(broken.Lines) != 0 {
		t.Fatalf("broken = %+v", broken)
	}
}

func TestLyricAnnotationJob(t *testing.T) {
	setupEditTest(t)
	originalDelay := lyricAnnotationPlanRetryDelay
	lyricAnnotationPlanRetryDelay = 0
	t.Cleanup(func() { lyricAnnotationPlanRetryDelay = originalDelay })
	var calls atomic.Int32
	reply := `{"lines":[{"i":0,"phrases":[{"text":"心动","effect":"swell"}]}]}`
	var fail atomic.Bool
	var lastUser atomic.Value
	done := make(chan struct{}, 4)
	service := &lyricAnnotationService{
		jobs:        make(map[string]*lyricAnnotationJob),
		limiter:     &aiLimiter{},
		concurrency: func() int { return 1 },
		// 只数全曲规划的请求（每次生成一次）；逐段标注返回同样的短语
		complete: func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
			if system == lyricAnnotationPlanPrompt {
				lastUser.Store(user)
				calls.Add(1)
			}
			if fail.Load() {
				return "", errors.New("boom")
			}
			return reply, nil
		},
		done: func() { done <- struct{}{} },
		// 热评只在生成时拉取，并写进用户消息
		hotComments: func(context.Context, int64) []lyricAnnotationComment {
			return []lyricAnnotationComment{{Content: "听哭了", Liked: 42}}
		},
	}
	wait := func() {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("annotation job did not finish")
		}
	}
	cfg := tools.AIConfig{Model: "test"}
	info := lyricAnnotationInfo{Title: "歌"}
	ttl := 24 * time.Hour

	got, svcerr := service.get(1, []string{"怦然心动"}, info, cfg, ttl)
	if svcerr != nil || got.Status != lyricAnnotationStatusPending {
		t.Fatalf("first call = %+v, %v", got, svcerr)
	}
	wait()
	if user, _ := lastUser.Load().(string); !strings.Contains(user, "听哭了（42 赞）") || !strings.Contains(user, "歌名：歌") {
		t.Fatalf("user prompt = %q", user)
	}
	got, svcerr = service.get(1, []string{"怦然心动"}, info, cfg, ttl)
	if svcerr != nil || got.Status != lyricAnnotationStatusReady || len(got.Lines) != 1 || got.Lines[0].Phrases[0].Text != "心动" {
		t.Fatalf("ready = %+v, %v", got, svcerr)
	}
	// 结果已保存：不再调用模型
	if _, _ = service.get(1, []string{"怦然心动"}, info, cfg, ttl); calls.Load() != 1 {
		t.Fatalf("model called %d times", calls.Load())
	}

	// 过期后先返回旧结果并在后台重新生成，生成完成后不再是旧结果
	repo.GetDB().Model(&model.LyricAnnotation{}).Where("song_id = ?", 1).Update("created_at", time.Now().Add(-2*ttl))
	if got, svcerr = service.get(1, []string{"怦然心动"}, info, cfg, ttl); svcerr != nil || got.Status != lyricAnnotationStatusReady || !got.Stale || len(got.Lines) != 1 {
		t.Fatalf("expired = %+v, %v", got, svcerr)
	}
	wait()
	if got, _ = service.get(1, []string{"怦然心动"}, info, cfg, ttl); got.Stale || calls.Load() != 2 {
		t.Fatalf("regenerated = %+v, model called %d times", got, calls.Load())
	}

	// 管理员手动刷新：立即开始重新生成，生成期间返回旧结果
	if got = service.refresh(1, []string{"怦然心动"}, info, cfg); got.Status != lyricAnnotationStatusPending {
		t.Fatalf("refresh = %+v", got)
	}
	wait()
	if got, _ = service.get(1, []string{"怦然心动"}, info, cfg, ttl); got.Status != lyricAnnotationStatusReady || got.Stale || calls.Load() != 3 {
		t.Fatalf("refreshed = %+v, model called %d times", got, calls.Load())
	}
	var count int64
	repo.GetDB().Model(&model.LyricAnnotation{}).Where("song_id = ?", 1).Count(&count)
	if count != 1 {
		t.Fatalf("regenerated annotation should overwrite the old record, got %d records", count)
	}

	// 歌词文本变化后重新标注；失败后一段时间内不重试
	fail.Store(true)
	if got, _ = service.get(1, []string{"怦然心动", "新的一行"}, info, cfg, ttl); got.Status != lyricAnnotationStatusPending {
		t.Fatalf("changed lyric should start a new job, got %+v", got)
	}
	wait()
	if _, svcerr = service.get(1, []string{"怦然心动", "新的一行"}, info, cfg, ttl); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("failed job should not retry immediately, got %v", svcerr)
	}
	// 失败的那次生成会把全曲规划重试 lyricAnnotationPlanRetries 次
	if calls.Load() != int32(4+lyricAnnotationPlanRetries) {
		t.Fatalf("model called %d times", calls.Load())
	}
}

func TestLyricAnnotationPrompt(t *testing.T) {
	for name, prompt := range map[string]string{"plan": lyricAnnotationPlanPrompt, "lines": lyricAnnotationLinesPrompt} {
		if strings.Contains(prompt, "{{") {
			t.Fatalf("%s: palette or scene placeholder not replaced", name)
		}
		for _, scene := range lyricAnnotationSceneList {
			if !strings.Contains(prompt, scene.Key+" "+scene.Name) {
				t.Fatalf("%s: prompt missing scene %s", name, scene.Key)
			}
		}
		for _, font := range lyricAnnotationFontList {
			if !strings.Contains(prompt, font.Key+" "+font.Name) {
				t.Fatalf("%s: prompt missing font %s", name, font.Key)
			}
		}
		for _, color := range lyricAnnotationPalette {
			if !strings.Contains(prompt, color.Key+" "+color.Name) {
				t.Fatalf("%s: prompt missing color %s", name, color.Key)
			}
		}
		// 两步共用同一套规则（含上色与同一意象一致的要求）
		for _, rule := range []string{"65%以上的颜色联想概率", "不要这一处用一种颜色", "硬性规则", "情感与演出的对应"} {
			if !strings.Contains(prompt, rule) {
				t.Fatalf("%s: prompt missing rule %q", name, rule)
			}
		}
	}
	if !strings.Contains(lyricAnnotationPlanPrompt, "imagery") || !strings.Contains(lyricAnnotationLinesPrompt, "【本次标注范围】") {
		t.Fatal("task-specific instructions missing")
	}
	if len(lyricAnnotationScenes) != len(lyricAnnotationSceneList) {
		t.Fatal("duplicate scene keys")
	}
	if len(lyricAnnotationColors) != len(lyricAnnotationPalette) {
		t.Fatal("duplicate color keys in palette")
	}
	for legacy, mapped := range lyricAnnotationLegacyColors {
		if !lyricAnnotationColors[mapped] || lyricAnnotationColors[legacy] {
			t.Fatalf("legacy color %s maps to %s", legacy, mapped)
		}
	}
}

func TestSanitizeLyricIntroAndOutro(t *testing.T) {
	comments := []lyricAnnotationComment{{Content: "哈哈哈", Liked: 9}, {Content: "那年夏天我们都在", Liked: 5}}
	raw := `{"intro":"  「在离别的街口，\n风替我们说了再见」 ","outro_comment":2,"lines":[]}`
	got, err := sanitizeLyricAnnotations([]string{"晴天"}, comments, raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.Intro != "在离别的街口， 风替我们说了再见" {
		t.Fatalf("intro = %q", got.Intro)
	}
	if got.Outro == nil || got.Outro.Content != "那年夏天我们都在" || got.Outro.Liked != 5 {
		t.Fatalf("outro = %+v", got.Outro)
	}
	// 编号超出范围（或没有热评）时不展示；过长的导语截断
	long := strings.Repeat("长", lyricAnnotationMaxIntroRunes+5)
	got, _ = sanitizeLyricAnnotations([]string{"晴天"}, nil, `{"intro":"`+long+`","outro_comment":1,"lines":[]}`)
	if got.Outro != nil || len([]rune(got.Intro)) != lyricAnnotationMaxIntroRunes+1 {
		t.Fatalf("got = %+v", got)
	}
}

func TestSanitizeLyricMoments(t *testing.T) {
	lines := []string{"前奏", "副歌", "主歌", "副歌", "结尾", "尾声", "再见"}
	comments := []lyricAnnotationComment{{Content: "评论一", Liked: 30}, {Content: "评论二", Liked: 20}, {Content: "评论三", Liked: 10}}
	raw := `{"outro_comment":3,"moments":[
		{"i":3,"comment":1},
		{"i":1,"comment":1,"text":"热评用过了就用旁白"},
		{"i":3,"text":"同一行只放一个"},
		{"i":4,"comment":3},
		{"i":9,"text":"行号不存在"},
		{"i":5,"comment":2},
		{"i":6,"text":"「旁白」"},
		{"i":0,"text":"第五个"},
		{"i":2,"text":"超出 5 个"}
	],"lines":[]}`
	got, err := sanitizeLyricAnnotations(lines, comments, raw)
	if err != nil {
		t.Fatal(err)
	}
	// 按行号排序、最多 5 个；第二次出现的「副歌」记为 occurrence 1；与尾奏相同的热评不再使用，第 4 行没有旁白而被跳过
	want := []dto.MusicLyricAnnotationMoment{
		{Text: "前奏", Content: "第五个", Source: "ai"},
		{Text: "副歌", Occurrence: 0, Content: "热评用过了就用旁白", Source: "ai"},
		{Text: "副歌", Occurrence: 1, Content: "评论一", Source: "comment", Liked: 30},
		{Text: "尾声", Content: "评论二", Source: "comment", Liked: 20},
		{Text: "再见", Content: "旁白", Source: "ai"},
	}
	if !reflect.DeepEqual(got.Moments, want) {
		t.Fatalf("moments = %+v\nwant %+v", got.Moments, want)
	}
}
