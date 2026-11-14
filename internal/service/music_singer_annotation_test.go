package service

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/tools"
)

func stubLyricSingerService(
	t *testing.T,
	attrFn func(system, user string) (string, error),
	transFn func(system, user string) (string, error),
	comments []lyricAnnotationComment,
) (*atomic.Int32, *atomic.Int32, func()) {
	t.Helper()
	origPtr := lyricSingers
	done := make(chan struct{}, 8)
	var attrCalls, transCalls atomic.Int32

	svc := *origPtr
	svc.name = "test_singers_" + t.Name()
	svc.limiter = &llmclient.Limiter{}
	svc.concurrency = func() int { return 1 }
	svc.hotComments = func(context.Context, int64) []lyricAnnotationComment { return comments }
	svc.complete = func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
		attrCalls.Add(1)
		return attrFn(system, user)
	}
	svc.translateComplete = func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
		transCalls.Add(1)
		return transFn(system, user)
	}
	svc.done = func() { done <- struct{}{} }
	lyricSingers = &svc
	t.Cleanup(func() {
		lyricSingers = origPtr
	})
	wait := func() {
		t.Helper()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("lyric singer job did not finish")
		}
	}
	return &attrCalls, &transCalls, wait
}

func TestLyricSingersSoloFastPathAndNamedTTML(t *testing.T) {
	tracks := []dto.MusicTrackDto{
		{ID: 701, Name: "晴天", Artists: []string{"周杰伦"}},
		{ID: 702, Name: "珊瑚海", Artists: []string{"周杰伦", "梁心颐"}},
	}
	setupMusicTranslationEnv(t, tracks)

	duetTTML := `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata>
  <ttm:agent xml:id="v1" type="person"><ttm:name>周杰伦</ttm:name></ttm:agent>
  <ttm:agent xml:id="v2" type="person"><ttm:name>梁心颐</ttm:name></ttm:agent>
  <ttm:agent xml:id="v1000" type="group"><ttm:name>合唱</ttm:name></ttm:agent>
</metadata></head>
<body><div>
  <p begin="00:01.000" end="00:04.000" ttm:agent="v1">海平面远方开始阴霾</p>
  <p begin="00:05.000" end="00:08.000" ttm:agent="v2">悲伤要怎么平静纯白</p>
  <p begin="00:09.000" end="00:12.000" ttm:agent="v1 v2">转身离开 分手说不出来</p>
</div></body></tt>`

	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data:    &dto.MusicLyricDto{Lrc: lyricPart("[00:01.00]故事的小黄花\n[00:05.00]从出生那年就飘着\n")},
			outcome: lyricOutcomeHit,
		},
		"ttml": {
			data:    &dto.MusicTTMLDto{Source: "ttml-amll", TTML: duetTTML},
			outcome: lyricOutcomeHit,
		},
	})

	attrCalls, transCalls, wait := stubLyricSingerService(t,
		func(_, _ string) (string, error) {
			return "", nil
		},
		func(_, _ string) (string, error) {
			return `{"names":{"v1":"Jay Chou","v2":"Lara Veronin"}}`, nil
		},
		nil,
	)

	s := NewMusicService()
	ctx := context.Background()

	// 1. 单歌手且无多声部 / 无行内 "歌手：" 提示：零 LLM 开销直接返回空声部 ready
	solo, svcerr := s.GetLyricSingers(ctx, 701, "ncm-lrc", "")
	if svcerr != nil || solo.Status != "ready" || len(solo.Singers) != 0 || attrCalls.Load() != 0 {
		t.Fatalf("solo fast path = %+v, err=%v, calls=%d", solo, svcerr, attrCalls.Load())
	}

	// 2. 具名 TTML 多声部：确定性解析无需归属 LLM，且开启 en 译名时异步翻译歌手名
	duet, svcerr := s.GetLyricSingers(ctx, 702, "ttml-amll", "en")
	if svcerr != nil || duet.Status != "ready" || attrCalls.Load() != 0 || !duet.TranslationPending {
		t.Fatalf("named TTML duet = %+v, err=%v, attrCalls=%d", duet, svcerr, attrCalls.Load())
	}
	if len(duet.Singers) < 3 || len(duet.Lines) != 3 {
		t.Fatalf("unexpected duet singers/lines: %+v", duet)
	}
	wait()

	duetTranslated, svcerr := s.GetLyricSingers(ctx, 702, "ttml-amll", "en")
	if svcerr != nil || duetTranslated.TranslationPending || transCalls.Load() != 1 {
		t.Fatalf("after singer translation = %+v, err=%v, transCalls=%d", duetTranslated, svcerr, transCalls.Load())
	}
	if duetTranslated.TranslatedNames["v1"] != "Jay Chou" || duetTranslated.TranslatedNames["v2"] != "Lara Veronin" {
		t.Fatalf("translated names = %+v", duetTranslated.TranslatedNames)
	}
}

func TestLyricSingersAIAttributionWithLRC(t *testing.T) {
	track := dto.MusicTrackDto{ID: 703, Name: "因为爱情", Artists: []string{"陈奕迅", "王菲"}}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data: &dto.MusicLyricDto{
				Lrc: lyricPart("[00:01.00]给你一张过去的CD\n[00:05.00]听听那时我们的爱情\n[00:09.00]因为爱情 不会轻易悲伤\n"),
			},
			outcome: lyricOutcomeHit,
		},
	})

	attrCalls, transCalls, wait := stubLyricSingerService(t,
		func(_, _ string) (string, error) {
			return `{
				"singers":[
					{"id":"v1","name":"王菲","role":"person","color":"cherry-blossom","align":"left"},
					{"id":"v2","name":"陈奕迅","role":"person","color":"ocean","align":"right"},
					{"id":"together","name":"合唱","role":"group","color":"lavender","align":"center"}
				],
				"lines":[
					{"i":1,"agent":"v1"},
					{"i":2,"agent":"v2"},
					{"i":3,"agent":"together"}
				]
			}`, nil
		},
		func(_, _ string) (string, error) {
			return `{"names":{"v1":"Faye Wong","v2":"Eason Chan","together":"Chorus"}}`, nil
		},
		[]lyricAnnotationComment{{Content: "第一句是王菲清唱起手，陈奕迅接着进来", Liked: 120}},
	)

	s := NewMusicService()
	ctx := context.Background()

	first, svcerr := s.GetLyricSingers(ctx, 703, "ncm-lrc", "en")
	if svcerr != nil || first.Status != "pending" {
		t.Fatalf("first get = %+v, err=%v", first, svcerr)
	}
	wait() // 完成 AI 声部归属
	// 取一次 en 译名触发翻译任务
	mid, svcerr := s.GetLyricSingers(ctx, 703, "ncm-lrc", "en")
	if svcerr != nil || mid.Status != "ready" || len(mid.Lines) != 3 {
		t.Fatalf("mid ready = %+v, err=%v", mid, svcerr)
	}
	if mid.TranslationPending {
		wait()
	}

	ready, svcerr := s.GetLyricSingers(ctx, 703, "ncm-lrc", "en")
	if svcerr != nil || ready.Status != "ready" || ready.TranslationPending {
		t.Fatalf("final ready = %+v, err=%v", ready, svcerr)
	}
	if attrCalls.Load() != 1 || transCalls.Load() != 1 {
		t.Fatalf("unexpected call counts: attr=%d trans=%d", attrCalls.Load(), transCalls.Load())
	}
	if ready.Lines[0].Agent != "v1" || ready.Lines[1].Agent != "v2" || ready.Lines[2].Agent != "together" {
		t.Fatalf("lines = %+v", ready.Lines)
	}
	if ready.TranslatedNames["v1"] != "Faye Wong" || ready.TranslatedNames["v2"] != "Eason Chan" {
		t.Fatalf("translated names = %+v", ready.TranslatedNames)
	}
}
