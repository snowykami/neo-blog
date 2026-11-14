package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/utils"
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
	svc.agentChat = nil
	svc.searchMoegirl = nil
	svc.searchWeb = nil
	svc.fetchPage = nil
	svc.moegirlAPIBase = ""
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
	t.Run("plain_solo_lyrics_without_cues_skip_ai", func(t *testing.T) {
		tracks := []dto.MusicTrackDto{
			{ID: 713, Name: "七里香", Artists: []string{"周杰伦"}},
		}
		setupMusicTranslationEnv(t, tracks)

		s := NewMusicService()
		ctx := context.Background()

		stubLyricSources(t, map[string]lyricSourceResult{
			"qq": {
				data: &dto.MusicQQLyricDto{
					Format: "qrc",
					Lyric:  "[1000,3000]窗外的(1000,1500)麻雀(2500,1500)\n[5000,3000]在电线杆上(5000,2000)多嘴(7000,1000)\n",
				},
				outcome: lyricOutcomeHit,
			},
		})
		attrCalls, transCalls, _ := stubLyricSingerService(t,
			func(_, _ string) (string, error) {
				t.Fatalf("unexpected AI attribution call for solo qq-qrc")
				return "", nil
			},
			func(_, _ string) (string, error) {
				t.Fatalf("unexpected AI translation call for solo qq-qrc")
				return `{}`, nil
			},
			nil,
		)
		resp, svcerr := s.GetLyricSingers(ctx, 713, "qq-qrc", "en")
		if svcerr != nil || resp.Status != "ready" || len(resp.Singers) != 0 || len(resp.Lines) != 0 {
			t.Fatalf("unexpected solo qq-qrc resp = %+v, err=%v", resp, svcerr)
		}
		if attrCalls.Load() != 0 || transCalls.Load() != 0 {
			t.Fatalf("expected 0 AI calls for solo qq-qrc, got attr=%d trans=%d", attrCalls.Load(), transCalls.Load())
		}
	})

	t.Run("inline_cues_attribute_and_exclude_non_vocal_creator", func(t *testing.T) {
		track := dto.MusicTrackDto{ID: 703, Name: "因为爱情", Artists: []string{"陈奕迅", "王菲", "小柯"}}
		setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
		stubLyricSources(t, map[string]lyricSourceResult{
			"ncm": {
				data: &dto.MusicLyricDto{
					Lrc: lyricPart("[00:00.20]作词：小柯\n[00:01.00]男：给你一张过去的CD\n[00:05.00]女：听听那时我们的爱情\n[00:09.00]男：有时会突然忘了我还在爱着你\n[00:13.00]合：因为爱情 不会轻易悲伤\n"),
				},
				outcome: lyricOutcomeHit,
			},
		})

		var capturedUser string
		attrCalls, transCalls, wait := stubLyricSingerService(t,
			func(_, user string) (string, error) {
				capturedUser = user
				return `{
					"singers":[
						{"id":"v1","name":"王菲","role":"person","color":"cherry-blossom","align":"left"},
						{"id":"v2","name":"陈奕迅","role":"person","color":"ocean","align":"right"},
						{"id":"v3","name":"小柯","role":"person","color":"amber","align":"right"},
						{"id":"together","name":"合唱","role":"group","color":"lavender","align":"center"}
					],
					"lines":[
						{"i":1,"agent":"v2"},
						{"i":2,"agent":"v1"},
						{"i":3,"agent":"v3"},
						{"i":4,"agent":"together"}
					]
				}`, nil
			},
			func(_, _ string) (string, error) {
				return `{"names":{"v1":"Faye Wong","v2":"Eason Chan","v3":"Xiao Ke","together":"Chorus"}}`, nil
			},
			[]lyricAnnotationComment{{Content: "第一句是陈奕迅唱起，王菲接唱", Liked: 120}},
		)

		s := NewMusicService()
		ctx := context.Background()

		first, svcerr := s.GetLyricSingers(ctx, 703, "ncm-lrc", "en")
		if svcerr != nil || first.Status != "pending" {
			t.Fatalf("first get = %+v, err=%v", first, svcerr)
		}
		wait() // 完成 AI 声部归属

		if !strings.Contains(capturedUser, "excluded_non_vocal_creators") || !strings.Contains(capturedUser, "小柯") {
			t.Fatalf("expected excluded_non_vocal_creators containing 小柯 in user prompt, got %s", capturedUser)
		}
		if !strings.Contains(capturedUser, "inline_cue") || !strings.Contains(capturedUser, "男") {
			t.Fatalf("expected inline_cue containing 男 in user prompt, got %s", capturedUser)
		}

		// 取一次 en 译名触发翻译任务
		mid, svcerr := s.GetLyricSingers(ctx, 703, "ncm-lrc", "en")
		if svcerr != nil || mid.Status != "ready" {
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
		names := make([]string, 0, len(ready.Singers))
		for _, sg := range ready.Singers {
			if sg.Name == "小柯" {
				t.Fatalf("expected non-vocal creator 小柯 stripped from singers, got %+v", ready.Singers)
			}
			names = append(names, sg.Name)
		}
		if len(ready.Singers) != 3 {
			t.Fatalf("expected 3 valid singers after stripping 小柯, got %+v (%v)", ready.Singers, names)
		}
		if ready.TranslatedNames["v1"] != "Faye Wong" || ready.TranslatedNames["v2"] != "Eason Chan" || ready.TranslatedNames["together"] != "Chorus" {
			t.Fatalf("translated names = %+v", ready.TranslatedNames)
		}
	})

	t.Run("bracket_section_cues_attribute", func(t *testing.T) {
		track := dto.MusicTrackDto{ID: 712, Name: "因为爱情", Artists: []string{"陈奕迅", "王菲"}}
		setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
		stubLyricSources(t, map[string]lyricSourceResult{
			"ncm": {
				data: &dto.MusicLyricDto{
					Lrc: lyricPart("[00:01.00]【陈奕迅】\n[00:02.00]给你一张过去的CD\n[00:06.00]【王菲】\n[00:07.00]听听那时我们的爱情\n"),
				},
				outcome: lyricOutcomeHit,
			},
		})

		var capturedUser string
		attrCalls, _, wait := stubLyricSingerService(t,
			func(_, user string) (string, error) {
				capturedUser = user
				return `{
					"singers":[
						{"id":"v1","name":"陈奕迅","role":"person","color":"ocean","align":"left"},
						{"id":"v2","name":"王菲","role":"person","color":"cherry-blossom","align":"right"}
					],
					"lines":[
						{"i":1,"agent":"v1"},
						{"i":2,"agent":"v2"}
					]
				}`, nil
			},
			func(_, _ string) (string, error) { return `{}`, nil },
			nil,
		)

		s := NewMusicService()
		ctx := context.Background()
		first, svcerr := s.GetLyricSingers(ctx, 712, "ncm-lrc", "")
		if svcerr != nil || first.Status != "pending" {
			t.Fatalf("first get = %+v, err=%v", first, svcerr)
		}
		wait()

		ready, svcerr := s.GetLyricSingers(ctx, 712, "ncm-lrc", "")
		if svcerr != nil || ready.Status != "ready" {
			t.Fatalf("final ready = %+v, err=%v", ready, svcerr)
		}
		if attrCalls.Load() != 1 {
			t.Fatalf("expected 1 AI call, got %d", attrCalls.Load())
		}
		if !strings.Contains(capturedUser, `"section_cue":"陈奕迅"`) || !strings.Contains(capturedUser, `"section_cue":"王菲"`) {
			t.Fatalf("expected section_cue for 陈奕迅 and 王菲 in user prompt, got %s", capturedUser)
		}
		if len(ready.Lines) != 2 || ready.Lines[0].Agent != "v1" || ready.Lines[1].Agent != "v2" {
			t.Fatalf("lines = %+v", ready.Lines)
		}
	})
}

func TestLyricSingersTTMLNarrationFirstPreservesDeclaredAlignAndStarryExt(t *testing.T) {
	findAlign := func(singers []dto.LyricSingerItem, id string) string {
		for _, item := range singers {
			if item.ID == id {
				return item.Align
			}
		}
		return ""
	}

	t.Run("ttm_agent_declared_order_and_other_type", func(t *testing.T) {
		tracks := []dto.MusicTrackDto{
			{ID: 704, Name: "天下", Artists: []string{"筱白白"}},
		}
		setupMusicTranslationEnv(t, tracks)

		// v1(person 主唱筱白白) 在 head 声明在先，v2(other 念白) 声明在后但 body 第 1 句先开口
		ttml := `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata>
  <ttm:agent xml:id="v1" type="person"><ttm:name>筱白白</ttm:name></ttm:agent>
  <ttm:agent xml:id="v2" type="other"><ttm:name>念白</ttm:name></ttm:agent>
</metadata></head>
<body><div>
  <p begin="00:01.000" end="00:04.000" ttm:agent="v2">天干物燥</p>
  <p begin="00:05.000" end="00:08.000" ttm:agent="v1">明月爬阁楼</p>
</div></body></tt>`

		stubLyricSources(t, map[string]lyricSourceResult{
			"ttml": {
				data:    &dto.MusicTTMLDto{Source: "ttml-amll", TTML: ttml},
				outcome: lyricOutcomeHit,
			},
		})
		attrCalls, _, _ := stubLyricSingerService(t,
			func(_, _ string) (string, error) { return "", nil },
			func(_, _ string) (string, error) { return `{}`, nil },
			nil,
		)

		s := NewMusicService()
		resp, svcerr := s.GetLyricSingers(context.Background(), 704, "ttml-amll", "")
		if svcerr != nil || resp.Status != "ready" || attrCalls.Load() != 0 {
			t.Fatalf("unexpected resp = %+v, err=%v, calls=%d", resp, svcerr, attrCalls.Load())
		}
		if findAlign(resp.Singers, "v1") != "left" || findAlign(resp.Singers, "v2") != "right" {
			t.Fatalf("expected v1=left and v2(other)=right regardless of body order, got %+v", resp.Singers)
		}
		if len(resp.Lines) != 2 || resp.Lines[0].Agent != "v2" || resp.Lines[1].Agent != "v1" {
			t.Fatalf("lines mismatch = %+v", resp.Lines)
		}
	})

	t.Run("starry_extensions_v1_carrier_ids", func(t *testing.T) {
		tracks := []dto.MusicTrackDto{
			{ID: 705, Name: "小心嗯哼", Artists: []string{"筱白白"}},
		}
		setupMusicTranslationEnv(t, tracks)

		extJSON := `{"version":1,"agents":[{"id":"s1","kind":"person","names":[{"text":"筱白白","kind":"full"}]},{"id":"s2","kind":"other","names":[{"text":"念白","kind":"full"}]}],"lines":[{"key":"L1","agentIDs":["s2"]},{"key":"L2","agentIDs":["s1"]}]}`
		extB64 := base64.StdEncoding.EncodeToString([]byte(extJSON))
		ttml := `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/amll" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
<head><metadata>
  <ttm:agent xml:id="v1_2" type="person"><ttm:name>Carrier1</ttm:name></ttm:agent>
  <ttm:agent xml:id="v2_2" type="person"><ttm:name>Carrier2</ttm:name></ttm:agent>
  <amll:meta key="starry:extensions:v1" value="` + extB64 + `"/>
</metadata></head>
<body><div>
  <p begin="00:01.000" end="00:04.000" ttm:agent="v2_2" itunes:key="L1">天干物燥</p>
  <p begin="00:05.000" end="00:08.000" ttm:agent="v1_2" itunes:key="L2">明月爬阁楼</p>
</div></body></tt>`

		stubLyricSources(t, map[string]lyricSourceResult{
			"ttml": {
				data:    &dto.MusicTTMLDto{Source: "ttml-amll", TTML: ttml},
				outcome: lyricOutcomeHit,
			},
		})
		attrCalls, _, _ := stubLyricSingerService(t,
			func(_, _ string) (string, error) { return "", nil },
			func(_, _ string) (string, error) { return `{}`, nil },
			nil,
		)

		s := NewMusicService()
		resp, svcerr := s.GetLyricSingers(context.Background(), 705, "ttml-amll", "")
		if svcerr != nil || resp.Status != "ready" || attrCalls.Load() != 0 {
			t.Fatalf("unexpected starry ext resp = %+v, err=%v, calls=%d", resp, svcerr, attrCalls.Load())
		}
		if findAlign(resp.Singers, "s1") != "left" || findAlign(resp.Singers, "s2") != "right" {
			t.Fatalf("expected s1=left and s2=right, got %+v", resp.Singers)
		}
		if len(resp.Lines) != 2 || resp.Lines[0].Agent != "s2" || resp.Lines[1].Agent != "s1" {
			t.Fatalf("starry ext lines mismatch = %+v", resp.Lines)
		}
	})
}

func TestLyricSingersLightweightAgentLoop(t *testing.T) {
	enablePrivateFetch := func(t *testing.T) {
		t.Helper()
		orig := utils.SafeFetchAllowPrivate
		utils.SafeFetchAllowPrivate = true
		t.Cleanup(func() { utils.SafeFetchAllowPrivate = orig })
	}

	t.Run("moegirl_color_markup_evidence_succeeds", func(t *testing.T) {
		enablePrivateFetch(t)
		tracks := []dto.MusicTrackDto{
			{ID: 720, Name: "カチューシャ（Katyusha）", Artists: []string{"上坂すみれ", "金元寿子"}, Album: "ガールズ&パンツァー"},
		}
		setupMusicTranslationEnv(t, tracks)
		stubLyricSources(t, map[string]lyricSourceResult{
			"qq": {
				data: &dto.MusicQQLyricDto{
					Format: "qrc",
					Lyric:  "[1000,3000]Поплыли(1000,1500) туманы(2500,1500) над(4000,500) рекой(4500,1500)\n[6000,3000]Выходила(6000,1500) на(7500,500) берег(8000,1000) Катюша(9000,1500)\n",
				},
				outcome: lyricOutcomeHit,
			},
		})

		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			q := r.URL.Query()
			if q.Get("list") == "search" {
				_, _ = w.Write([]byte(`{"query":{"search":[{"title":"喀秋莎(少女与战车)","snippet":"喀秋莎由诺娜与喀秋莎合唱"}]}}`))
				return
			}
			_, _ = w.Write([]byte(`{"query":{"pages":[{"title":"喀秋莎(少女与战车)","revisions":[{"slots":{"main":{"content":"== 歌词 ==\n{{歌手色标|#FF6699|诺娜（上坂堇）|#38BDF8|喀秋莎（金元寿子）}}\n{{color|#38BDF8|Поплыли туманы над рекой}}\n{{color|#FF6699|Выходила на берег Катюша}}"}}}]}]}}`))
		}))
		defer srv.Close()

		var chatCalls atomic.Int32
		var sawMoegirlWikitext bool
		_, transCalls, wait := stubLyricSingerService(t, nil,
			func(_, _ string) (string, error) {
				return `{"names":{"v1":"Sumire Uesaka","v2":"Hisako Kanemoto"}}`, nil
			},
			nil,
		)
		lyricSingers.moegirlAPIBase = srv.URL + "/api.php"
		lyricSingers.agentChat = func(_ context.Context, _ tools.AIConfig, messages []singerAgentMessage, _ []singerAgentToolDef) (*singerAgentChatResult, error) {
			step := chatCalls.Add(1)
			if step == 1 {
				var call singerAgentToolCall
				call.ID = "tc_1"
				call.Type = "function"
				call.Function.Name = "search_moegirl"
				call.Function.Arguments = `{"query":"カチューシャ 少女与战车"}`
				return &singerAgentChatResult{ToolCalls: []singerAgentToolCall{call}}, nil
			}
			for _, msg := range messages {
				if msg.Role == "tool" && msg.Content != nil && strings.Contains(*msg.Content, "{{歌手色标") && strings.Contains(*msg.Content, "{{color|#38BDF8|") {
					sawMoegirlWikitext = true
				}
			}
			return &singerAgentChatResult{
				Content: `{
					"empty": false,
					"evidence_source": "moegirl",
					"evidence_url": "https://zh.moegirl.org.cn/喀秋莎(少女与战车)",
					"singers": [
						{"id":"v1","name":"上坂すみれ","role":"person","color":"cherry-blossom","align":"left"},
						{"id":"v2","name":"金元寿子","role":"person","color":"ocean","align":"right"}
					],
					"lines": [
						{"i":1,"agent":"v2"},
						{"i":2,"agent":"v1"}
					]
				}`,
			}, nil
		}

		s := NewMusicService()
		ctx := context.Background()
		first, svcerr := s.GetLyricSingers(ctx, 720, "qq-qrc", "en")
		if svcerr != nil || first.Status != "pending" {
			t.Fatalf("first = %+v, err=%v", first, svcerr)
		}
		wait()

		if !sawMoegirlWikitext || chatCalls.Load() != 2 {
			t.Fatalf("expected 2 agent rounds reading moegirl wikitext, calls=%d saw=%v", chatCalls.Load(), sawMoegirlWikitext)
		}

		mid, svcerr := s.GetLyricSingers(ctx, 720, "qq-qrc", "en")
		if svcerr != nil || mid.Status != "ready" {
			t.Fatalf("mid = %+v, err=%v", mid, svcerr)
		}
		if mid.TranslationPending {
			wait()
		}
		ready, svcerr := s.GetLyricSingers(ctx, 720, "qq-qrc", "en")
		if svcerr != nil || ready.Status != "ready" || ready.TranslationPending || transCalls.Load() != 1 {
			t.Fatalf("ready = %+v, err=%v, transCalls=%d", ready, svcerr, transCalls.Load())
		}
		if len(ready.Singers) != 2 || len(ready.Lines) != 2 || ready.Lines[0].Agent != "v2" || ready.Lines[1].Agent != "v1" {
			t.Fatalf("unexpected attribution = %+v", ready)
		}
		if ready.TranslatedNames["v1"] != "Sumire Uesaka" || ready.TranslatedNames["v2"] != "Hisako Kanemoto" {
			t.Fatalf("translated names = %+v", ready.TranslatedNames)
		}
	})

	t.Run("web_search_and_fetch_page_preserves_color_tags", func(t *testing.T) {
		enablePrivateFetch(t)
		tracks := []dto.MusicTrackDto{
			{ID: 721, Name: "经过（日文版）", Artists: []string{"角色A", "角色B"}, Album: "原神"},
		}
		setupMusicTranslationEnv(t, tracks)
		stubLyricSources(t, map[string]lyricSourceResult{
			"ncm": {
				data: &dto.MusicLyricDto{
					Lrc: lyricPart("[00:01.00]第一句日文歌词\n[00:05.00]第二句日文歌词\n[00:09.00]第三句合唱歌词\n"),
				},
				outcome: lyricOutcomeHit,
			},
		})

		htmlSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><body>
				<p><span style="color:#ff6699">角色A</span> / <span style="color:#38bdf8">角色B</span> / 合唱</p>
				<div class="lyrics">
					<p><span style="color:#ff6699">第一句日文歌词</span></p>
					<p><span style="color:#38bdf8">第二句日文歌词</span></p>
					<p><span data-singer="合唱">第三句合唱歌词</span></p>
				</div>
			</body></html>`))
		}))
		defer htmlSrv.Close()

		pageURL := htmlSrv.URL + "/lyrics"
		var sawColorMarkers bool
		_, _, wait := stubLyricSingerService(t, nil, func(_, _ string) (string, error) { return `{}`, nil }, nil)
		lyricSingers.searchWeb = func(_ context.Context, _ string) (string, error) {
			b, _ := json.Marshal(map[string]any{
				"results": []webSearchHit{{Title: "经过 歌词分工", URL: pageURL, Snippet: "颜色标注"}},
			})
			return string(b), nil
		}
		var stepCount atomic.Int32
		lyricSingers.agentChat = func(_ context.Context, _ tools.AIConfig, messages []singerAgentMessage, _ []singerAgentToolDef) (*singerAgentChatResult, error) {
			switch stepCount.Add(1) {
			case 1:
				var c singerAgentToolCall
				c.ID, c.Type = "tc_w1", "function"
				c.Function.Name = "search_web"
				c.Function.Arguments = `{"query":"经过 日文版 原神 歌词 角色"}`
				return &singerAgentChatResult{ToolCalls: []singerAgentToolCall{c}}, nil
			case 2:
				var c singerAgentToolCall
				c.ID, c.Type = "tc_w2", "function"
				c.Function.Name = "fetch_page"
				c.Function.Arguments = fmt.Sprintf(`{"url":%q}`, pageURL)
				return &singerAgentChatResult{ToolCalls: []singerAgentToolCall{c}}, nil
			default:
				for _, msg := range messages {
					if msg.Role == "tool" && msg.Content != nil &&
						strings.Contains(*msg.Content, "[color:#ff6699]") &&
						strings.Contains(*msg.Content, "[color:#38bdf8]") &&
						strings.Contains(*msg.Content, "[singer:合唱]") {
						sawColorMarkers = true
					}
				}
				return &singerAgentChatResult{
					Content: fmt.Sprintf(`{
						"empty":false,
						"evidence_source":"web",
						"evidence_url":%q,
						"singers":[
							{"id":"v1","name":"角色A","role":"person","color":"cherry-blossom","align":"left"},
							{"id":"v2","name":"角色B","role":"person","color":"ocean","align":"right"},
							{"id":"together","name":"合唱","role":"group","color":"lavender","align":"center"}
						],
						"lines":[{"i":1,"agent":"v1"},{"i":2,"agent":"v2"},{"i":3,"agent":"together"}]
					}`, pageURL),
				}, nil
			}
		}

		s := NewMusicService()
		ctx := context.Background()
		first, svcerr := s.GetLyricSingers(ctx, 721, "ncm-lrc", "")
		if svcerr != nil || first.Status != "pending" {
			t.Fatalf("first = %+v, err=%v", first, svcerr)
		}
		wait()

		ready, svcerr := s.GetLyricSingers(ctx, 721, "ncm-lrc", "")
		if svcerr != nil || ready.Status != "ready" || !sawColorMarkers {
			t.Fatalf("ready = %+v, err=%v, sawColorMarkers=%v", ready, svcerr, sawColorMarkers)
		}
		if len(ready.Singers) != 3 || len(ready.Lines) != 3 {
			t.Fatalf("unexpected web attribution = %+v", ready)
		}
	})

	t.Run("unverified_guess_fake_url_and_studio_strictly_rejected", func(t *testing.T) {
		enablePrivateFetch(t)
		tracks := []dto.MusicTrackDto{
			{ID: 722, Name: "光亮", Artists: []string{"周深", "钱雷"}},
			{ID: 723, Name: "经过", Artists: []string{"张杰", "HOYO-MiX"}, Album: "原神-经过"},
		}
		setupMusicTranslationEnv(t, tracks)

		// 子例 A：模型未读取任何页面却试图伪造 evidence_url 瞎猜 -> 强制落库 Empty: true
		stubLyricSources(t, map[string]lyricSourceResult{
			"ncm": {
				data:    &dto.MusicLyricDto{Lrc: lyricPart("[00:01.00]莫听穿林打叶声\n[00:05.00]一蓑烟雨任平生\n")},
				outcome: lyricOutcomeHit,
			},
		})
		_, _, waitA := stubLyricSingerService(t, nil, func(_, _ string) (string, error) { return `{}`, nil }, nil)
		lyricSingers.agentChat = func(_ context.Context, _ tools.AIConfig, _ []singerAgentMessage, _ []singerAgentToolDef) (*singerAgentChatResult, error) {
			return &singerAgentChatResult{
				Content: `{
					"empty":false,
					"evidence_source":"moegirl",
					"evidence_url":"https://zh.moegirl.org.cn/光亮",
					"singers":[
						{"id":"v1","name":"周深","role":"person","color":"ocean","align":"left"},
						{"id":"v2","name":"钱雷","role":"person","color":"gold","align":"right"}
					],
					"lines":[{"i":1,"agent":"v1"},{"i":2,"agent":"v2"}]
				}`,
			}, nil
		}

		s := NewMusicService()
		ctx := context.Background()
		_, _ = s.GetLyricSingers(ctx, 722, "ncm-lrc", "")
		waitA()
		respA, svcerr := s.GetLyricSingers(ctx, 722, "ncm-lrc", "")
		if svcerr != nil || respA.Status != "ready" || len(respA.Singers) != 0 || len(respA.Lines) != 0 {
			t.Fatalf("expected ungrounded guess rejected as empty, got %+v, err=%v", respA, svcerr)
		}

		// 子例 B：原神《经过》中文独唱版（张杰 / HOYO-MiX），即使读取了页面且模型误把 HOYO-MiX 当歌手 -> 厂牌剔除后只剩 1 人强制为空
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_, _ = w.Write([]byte(`{"query":{"pages":[{"title":"经过(原神)","revisions":[{"slots":{"main":{"content":"中文版由张杰独唱，HOYO-MiX 制作。\n第一句歌词\n第二句歌词"}}}]}]}}`))
		}))
		defer srv.Close()

		var promptHadExcludedStudio bool
		var stepB atomic.Int32
		_, _, waitB := stubLyricSingerService(t, nil, func(_, _ string) (string, error) { return `{}`, nil }, nil)
		lyricSingers.moegirlAPIBase = srv.URL + "/api.php"
		lyricSingers.agentChat = func(_ context.Context, _ tools.AIConfig, messages []singerAgentMessage, _ []singerAgentToolDef) (*singerAgentChatResult, error) {
			if len(messages) >= 2 && messages[1].Content != nil && strings.Contains(*messages[1].Content, "HOYO-MiX") && strings.Contains(*messages[1].Content, "excluded_non_vocal_creators") {
				promptHadExcludedStudio = true
			}
			if stepB.Add(1) == 1 {
				var c singerAgentToolCall
				c.ID, c.Type = "tc_b1", "function"
				c.Function.Name = "search_moegirl"
				c.Function.Arguments = `{"page_title":"经过(原神)"}`
				return &singerAgentChatResult{ToolCalls: []singerAgentToolCall{c}}, nil
			}
			return &singerAgentChatResult{
				Content: `{
					"empty":false,
					"evidence_source":"moegirl",
					"evidence_url":"https://zh.moegirl.org.cn/经过(原神)",
					"singers":[
						{"id":"v1","name":"张杰","role":"person","color":"ocean","align":"left"},
						{"id":"v2","name":"HOYO-MiX","role":"person","color":"gold","align":"right"}
					],
					"lines":[{"i":1,"agent":"v1"},{"i":2,"agent":"v2"}]
				}`,
			}, nil
		}
		_, _ = s.GetLyricSingers(ctx, 723, "ncm-lrc", "")
		waitB()
		respB, svcerr := s.GetLyricSingers(ctx, 723, "ncm-lrc", "")
		if svcerr != nil || !promptHadExcludedStudio || len(respB.Singers) != 0 || len(respB.Lines) != 0 {
			t.Fatalf("expected HOYO-MiX excluded leaving empty result, promptHadStudio=%v, resp=%+v, err=%v", promptHadExcludedStudio, respB, svcerr)
		}
	})

	t.Run("exceeding_max_tool_rounds_aborts_immediately_as_empty", func(t *testing.T) {
		tracks := []dto.MusicTrackDto{
			{ID: 724, Name: "无证据合唱", Artists: []string{"歌手甲", "歌手乙"}},
		}
		setupMusicTranslationEnv(t, tracks)
		stubLyricSources(t, map[string]lyricSourceResult{
			"ncm": {
				data:    &dto.MusicLyricDto{Lrc: lyricPart("[00:01.00]第一行\n[00:05.00]第二行\n")},
				outcome: lyricOutcomeHit,
			},
		})

		var chatCalls atomic.Int32
		_, _, wait := stubLyricSingerService(t, nil, func(_, _ string) (string, error) { return `{}`, nil }, nil)
		lyricSingers.searchWeb = func(_ context.Context, _ string) (string, error) {
			return `{"results":[]}`, nil
		}
		lyricSingers.agentChat = func(_ context.Context, _ tools.AIConfig, _ []singerAgentMessage, _ []singerAgentToolDef) (*singerAgentChatResult, error) {
			n := chatCalls.Add(1)
			var c singerAgentToolCall
			c.ID = fmt.Sprintf("tc_loop_%d", n)
			c.Type = "function"
			c.Function.Name = "search_web"
			c.Function.Arguments = fmt.Sprintf(`{"query":"q_%d"}`, n)
			return &singerAgentChatResult{ToolCalls: []singerAgentToolCall{c}}, nil
		}

		s := NewMusicService()
		ctx := context.Background()
		_, _ = s.GetLyricSingers(ctx, 724, "ncm-lrc", "")
		wait()

		if chatCalls.Load() != lyricSingerMaxToolRounds+1 {
			t.Fatalf("expected exact %d calls before abort, got %d", lyricSingerMaxToolRounds+1, chatCalls.Load())
		}
		ready, svcerr := s.GetLyricSingers(ctx, 724, "ncm-lrc", "")
		if svcerr != nil || ready.Status != "ready" || len(ready.Singers) != 0 || len(ready.Lines) != 0 {
			t.Fatalf("expected aborted job saved as ready empty, got %+v, err=%v", ready, svcerr)
		}
	})

	t.Run("isolated_limiter_not_held_during_web_io_and_translate_only", func(t *testing.T) {
		if lyricSingers.limiter == llmclient.DefaultLimiter || lyricSingers.limiter.Name != "ai_lyric_singer" {
			t.Fatalf("expected dedicated limiter ai_lyric_singer, got %+v", lyricSingers.limiter)
		}

		enablePrivateFetch(t)
		tracks := []dto.MusicTrackDto{
			{ID: 725, Name: "并发隔离测试", Artists: []string{"上坂すみれ", "金元寿子"}},
		}
		setupMusicTranslationEnv(t, tracks)
		stubLyricSources(t, map[string]lyricSourceResult{
			"ncm": {
				data:    &dto.MusicLyricDto{Lrc: lyricPart("[00:01.00]Line 1\n[00:05.00]Line 2\n")},
				outcome: lyricOutcomeHit,
			},
		})

		toolEntered := make(chan struct{})
		releaseTool := make(chan struct{})
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			if r.URL.Query().Get("list") == "search" {
				_, _ = w.Write([]byte(`{"query":{"search":[{"title":"隔离曲目"}]}}`))
				return
			}
			_, _ = w.Write([]byte(`{"query":{"pages":[{"title":"隔离曲目","revisions":[{"slots":{"main":{"content":"{{color|#FF6699|Line 1}}\n{{color|#38BDF8|Line 2}}"}}}]}]}}`))
		}))
		defer srv.Close()

		var chatCalls, transCalls2 atomic.Int32
		_, transCalls, wait := stubLyricSingerService(t, nil,
			func(sys, user string) (string, error) {
				if strings.Contains(sys, "(code: ja)") || strings.Contains(user, "\"ja (") {
					transCalls2.Add(1)
					return `{"names":{"v1":"上坂すみれ","v2":"金元寿子"}}`, nil
				}
				return `{"names":{"v1":"Sumire Uesaka","v2":"Hisako Kanemoto"}}`, nil
			},
			nil,
		)
		lyricSingers.moegirlAPIBase = srv.URL + "/api.php"
		origSearchMoegirl := lyricSingers.defaultSearchMoegirl
		lyricSingers.searchMoegirl = func(ctx context.Context, query, pageTitle string) (string, string, error) {
			close(toolEntered)
			<-releaseTool
			return origSearchMoegirl(ctx, query, pageTitle)
		}
		lyricSingers.agentChat = func(_ context.Context, _ tools.AIConfig, _ []singerAgentMessage, _ []singerAgentToolDef) (*singerAgentChatResult, error) {
			if chatCalls.Add(1) == 1 {
				var c singerAgentToolCall
				c.ID, c.Type = "tc_iso", "function"
				c.Function.Name = "search_moegirl"
				c.Function.Arguments = `{"query":"隔离曲目"}`
				return &singerAgentChatResult{ToolCalls: []singerAgentToolCall{c}}, nil
			}
			return &singerAgentChatResult{
				Content: `{
					"empty":false,
					"evidence_source":"moegirl",
					"evidence_url":"https://zh.moegirl.org.cn/隔离曲目",
					"singers":[
						{"id":"v1","name":"上坂すみれ","role":"person","color":"cherry-blossom","align":"left"},
						{"id":"v2","name":"金元寿子","role":"person","color":"ocean","align":"right"}
					],
					"lines":[{"i":1,"agent":"v1"},{"i":2,"agent":"v2"}]
				}`,
			}, nil
		}

		s := NewMusicService()
		ctx := context.Background()
		_, svcerr := s.GetLyricSingers(ctx, 725, "ncm-lrc", "en")
		if svcerr != nil {
			t.Fatalf("getOrStart failed: %v", svcerr)
		}
		<-toolEntered

		// 工具网络阻塞等待时，limiter(concurrency=1) 名额必须已被释放
		acquireCtx, acquireCancel := context.WithTimeout(ctx, 300*time.Millisecond)
		defer acquireCancel()
		if err := lyricSingers.limiter.AcquireTier(acquireCtx, lyricSingers.concurrency, llmclient.TierBackground, nil); err != nil {
			t.Fatalf("expected limiter slot released during web tool HTTP I/O, err=%v", err)
		}
		lyricSingers.limiter.Release()
		close(releaseTool)
		wait()

		// 触发一次 en 译名
		mid, _ := s.GetLyricSingers(ctx, 725, "ncm-lrc", "en")
		if mid.TranslationPending {
			wait()
		}
		beforeTranslateOnlyCalls := chatCalls.Load()

		// 仅刷新 ja 歌手译名：translateOnly=true 不应再触发 agentChat
		trResp, svcerr := s.RefreshLyricSingers(ctx, 725, "ncm-lrc", "ja", true)
		if svcerr != nil || trResp.Status != "ready" {
			t.Fatalf("translateOnly refresh = %+v, err=%v", trResp, svcerr)
		}
		if trResp.TranslationPending {
			wait()
		}
		if chatCalls.Load() != beforeTranslateOnlyCalls || transCalls.Load() != 2 || transCalls2.Load() != 1 {
			t.Fatalf("expected translateOnly not to rerun agentChat: chatBefore=%d chatNow=%d trans=%d jaTrans=%d",
				beforeTranslateOnlyCalls, chatCalls.Load(), transCalls.Load(), transCalls2.Load())
		}
	})
}
