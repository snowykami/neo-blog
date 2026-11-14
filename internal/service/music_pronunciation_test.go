package service

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
)

func stubLyricPronunciationService(t *testing.T, fn func(system, user string) (string, error)) (*atomic.Int32, func()) {
	t.Helper()
	origPtr := lyricPronunciations
	origRetry := lyricTranslationRetryDelay
	lyricTranslationRetryDelay = 0
	done := make(chan struct{}, 8)
	var calls atomic.Int32

	svc := *origPtr
	svc.name = "test_pron_" + t.Name()
	svc.limiter = &llmclient.Limiter{}
	svc.stream = nil
	svc.concurrency = func() int { return 1 }
	svc.complete = func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
		calls.Add(1)
		return fn(system, user)
	}
	svc.done = func() { done <- struct{}{} }
	lyricPronunciations = &svc
	t.Cleanup(func() {
		lyricPronunciations = origPtr
		lyricTranslationRetryDelay = origRetry
	})
	wait := func() {
		t.Helper()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("lyric pronunciation job did not finish")
		}
	}
	return &calls, wait
}

func TestPronunciationCompleteUpstreamShortCircuit(t *testing.T) {
	tracks := []dto.MusicTrackDto{
		{ID: 801, Name: "夜に駆ける", Artists: []string{"YOASOBI"}},
	}
	setupMusicTranslationEnv(t, tracks)

	// 801：NCM 自带全量有效罗马音 -> CompleteUpstream 短路免调 LLM
	jaLrc := "[00:01.00]沈むように\n[00:04.00]溶けてゆくように\n"
	jaRom := "[00:01.00]shizumu youni\n[00:04.00]tokete yuku youni\n"

	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data: &dto.MusicLyricDto{
				Lrc:     lyricPart(jaLrc),
				Romalrc: lyricPart(jaRom),
			},
			outcome: lyricOutcomeHit,
		},
	})

	calls, _ := stubLyricPronunciationService(t, func(_, _ string) (string, error) {
		return "", nil
	})

	s := NewMusicService()
	ctx := context.Background()

	// 全量原生音译应直接 ready 且 CompleteUpstream=true
	upstream, svcerr := s.GetLyricPronunciations(ctx, 801, "ncm-lrc")
	if svcerr != nil || upstream.Status != "ready" || !upstream.CompleteUpstream || calls.Load() != 0 {
		t.Fatalf("complete upstream = %+v, err=%v, calls=%d", upstream, svcerr, calls.Load())
	}
}

func TestPronunciationPartialGapFill(t *testing.T) {
	tracks := []dto.MusicTrackDto{
		{ID: 802, Name: "紫荆花盛开", Artists: []string{"李克勤", "周笔畅"}},
	}
	setupMusicTranslationEnv(t, tracks)

	// 802：仅粤语第 1 句已有原生粤拼，普通话第 2 句缺失 -> 仅送第 2 句给 AI 补全
	bilingualLrc := "[00:01.00]唔該你睇住我\n[00:05.00]我们心连心\n"
	bilingualRom := "[00:01.00]m4 goi1 nei5 tai2 zyu6 ngo5\n"

	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data: &dto.MusicLyricDto{
				Lrc:     lyricPart(bilingualLrc),
				Romalrc: lyricPart(bilingualRom),
			},
			outcome: lyricOutcomeHit,
		},
	})

	var gotUser atomic.Value
	calls, wait := stubLyricPronunciationService(t, func(_, user string) (string, error) {
		gotUser.Store(user)
		return `{"items":[{"i":1,"lang":"zh","pronunciation":"wǒ men xīn lián xīn"}]}`, nil
	})

	s := NewMusicService()
	ctx := context.Background()

	// 部分自带粤语粤拼：只补全第 2 句普通话
	first, svcerr := s.GetLyricPronunciations(ctx, 802, "ncm-lrc")
	if svcerr != nil || first.Status != "pending" {
		t.Fatalf("first get 802 = %+v, err=%v", first, svcerr)
	}
	wait()

	prompt := gotUser.Load().(string)
	_, linesSection, hasLines := strings.Cut(prompt, `"lines":[`)
	if !hasLines || strings.Contains(linesSection, "唔該你睇住我") || !strings.Contains(linesSection, "我们心连心") {
		t.Fatalf("prompt should exclude lines with upstream romanization: %s", prompt)
	}
	if !strings.Contains(prompt, "m4 goi1") {
		t.Fatalf("prompt should pass upstream_samples for style reference: %s", prompt)
	}

	ready, svcerr := s.GetLyricPronunciations(ctx, 802, "ncm-lrc")
	if svcerr != nil || ready.Status != "ready" || ready.CompleteUpstream || calls.Load() != 1 {
		t.Fatalf("ready 802 = %+v, err=%v, calls=%d", ready, svcerr, calls.Load())
	}
	if len(ready.Lines) != 1 || ready.Lines[0].Text != "我们心连心" || ready.Lines[0].Pronunciation != "wǒ men xīn lián xīn" {
		t.Fatalf("gap-filled lines = %+v", ready.Lines)
	}
}

func TestPronunciationWordTimedTokensAndBopomofo(t *testing.T) {
	tracks := []dto.MusicTrackDto{
		{ID: 803, Name: "稻香", Artists: []string{"周杰伦"}},
	}
	setupMusicTranslationEnv(t, tracks)

	yrc := "[1000,2000](1000,500,0)朋友(1500,500,0)們\n"
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data:    &dto.MusicLyricDto{Yrc: lyricPart(yrc)},
			outcome: lyricOutcomeHit,
		},
	})

	var gotUser atomic.Value
	calls, wait := stubLyricPronunciationService(t, func(_, user string) (string, error) {
		gotUser.Store(user)
		return `{"items":[{"i":1,"lang":"zh-tw","pronunciation":"ㄆㄥˊ ㄧㄡˇ ˙ㄇㄣ","tokens":["ㄆㄥˊ ㄧㄡˇ","˙ㄇㄣ"]}]}`, nil
	})

	s := NewMusicService()
	ctx := context.Background()

	first, svcerr := s.GetLyricPronunciations(ctx, 803, "ncm-yrc")
	if svcerr != nil || first.Status != "pending" {
		t.Fatalf("first get = %+v, err=%v", first, svcerr)
	}
	wait()

	prompt := gotUser.Load().(string)
	if !strings.Contains(prompt, `"tokens":["朋友","們"]`) || !strings.Contains(prompt, `"token_count":2`) {
		t.Fatalf("word-timed prompt mismatch: %s", prompt)
	}

	ready, svcerr := s.GetLyricPronunciations(ctx, 803, "ncm-yrc")
	if svcerr != nil || ready.Status != "ready" || calls.Load() != 1 {
		t.Fatalf("ready = %+v, err=%v, calls=%d", ready, svcerr, calls.Load())
	}
	if len(ready.Lines) != 1 || len(ready.Lines[0].Tokens) != 2 || ready.Lines[0].Tokens[1] != "˙ㄇㄣ" {
		t.Fatalf("bopomofo word tokens = %+v", ready.Lines)
	}
}

func TestPronunciationTaiwanMandarinSimplifiedAndCreditsAndHokkienExclusion(t *testing.T) {
	t.Run("taiwan_mandarin_simplified_retries_zh_to_bopomofo", func(t *testing.T) {
		tracks := []dto.MusicTrackDto{
			{ID: 804, Name: "外婆的澎湖湾", Artists: []string{"潘安邦"}},
		}
		setupMusicTranslationEnv(t, tracks)

		lrc := "[00:00.50]词曲：叶佳修\n[00:02.00]晚风轻拂澎湖湾\n[00:05.00]白浪逐沙滩\n"
		stubLyricSources(t, map[string]lyricSourceResult{
			"ncm": {
				data:    &dto.MusicLyricDto{Lrc: lyricPart(lrc)},
				outcome: lyricOutcomeHit,
			},
		})

		var prompts []string
		var attempt atomic.Int32
		calls, wait := stubLyricPronunciationService(t, func(system, user string) (string, error) {
			prompts = append(prompts, system+"\n"+user)
			if attempt.Add(1) == 1 {
				// 第一次声称 zh-tw 却返回了汉语拼音，应被脚本校验拦下并触发注音纠偏重试
				return `{"items":[{"i":1,"lang":"zh-tw","pronunciation":"wǎn fēng qīng fú péng hú wān"},{"i":2,"lang":"zh-tw","pronunciation":"bái làng zhú shā tān"}]}`, nil
			}
			return `{"items":[{"i":1,"lang":"zh-tw","pronunciation":"ㄨㄢˇ ㄈㄥ ㄑㄧㄥ ㄈㄨˊ ㄆㄥˊ ㄏㄨˊ ㄨㄢ"},{"i":2,"lang":"zh-tw","pronunciation":"ㄅㄞˊ ㄌㄤˋ ㄓㄨˊ ㄕㄚ ㄊㄢ"}]}`, nil
		})

		s := NewMusicService()
		ctx := context.Background()

		first, svcerr := s.GetLyricPronunciations(ctx, 804, "ncm-lrc")
		if svcerr != nil || first.Status != "pending" {
			t.Fatalf("first get 804 = %+v, err=%v", first, svcerr)
		}
		wait()

		ready, svcerr := s.GetLyricPronunciations(ctx, 804, "ncm-lrc")
		if svcerr != nil || ready.Status != "ready" {
			t.Fatalf("ready 804 = %+v, err=%v", ready, svcerr)
		}
		if calls.Load() != 2 || len(prompts) != 2 {
			t.Fatalf("expected retry on pinyin under zh-tw, calls=%d", calls.Load())
		}
		if strings.Contains(prompts[0], "taiwan_origin_hint") {
			t.Fatalf("unexpected hardcoded taiwan_origin_hint in prompt: %s", prompts[0])
		}
		if !strings.Contains(prompts[0], "词曲：叶佳修") || !strings.Contains(prompts[0], "zh-tw") {
			t.Fatalf("expected credits and Bopomofo prompt rules in prompt: %s", prompts[0])
		}
		if ready.Lang != "zh-tw" || len(ready.Lines) != 2 || ready.Lines[0].Lang != "zh-tw" {
			t.Fatalf("expected zh-tw bopomofo result, got %+v", ready)
		}
	})

	t.Run("taiwan_hokkien_uses_tailo_not_bopomofo", func(t *testing.T) {
		tracks := []dto.MusicTrackDto{
			{ID: 805, Name: "浪子回头", Artists: []string{"茄子蛋"}},
		}
		setupMusicTranslationEnv(t, tracks)

		lrc := "[00:01.00]烟一支一支一支地点\n[00:04.00]毋知影是啥物滋味 袂记咧\n"
		stubLyricSources(t, map[string]lyricSourceResult{
			"ncm": {
				data:    &dto.MusicLyricDto{Lrc: lyricPart(lrc)},
				outcome: lyricOutcomeHit,
			},
		})

		var gotUser atomic.Value
		calls, wait := stubLyricPronunciationService(t, func(_, user string) (string, error) {
			gotUser.Store(user)
			return `{"items":[{"i":1,"lang":"other","pronunciation":"ian tsit-ki tsit-ki tsit-ki teh tiám"},{"i":2,"lang":"other","pronunciation":"m̄ tsai-iánn sī siánn-mih tsu-bī buē-kì-leh"}]}`, nil
		})

		s := NewMusicService()
		ctx := context.Background()

		first, svcerr := s.GetLyricPronunciations(ctx, 805, "ncm-lrc")
		if svcerr != nil || first.Status != "pending" {
			t.Fatalf("first get 805 = %+v, err=%v", first, svcerr)
		}
		wait()

		ready, svcerr := s.GetLyricPronunciations(ctx, 805, "ncm-lrc")
		if svcerr != nil || ready.Status != "ready" || calls.Load() != 1 {
			t.Fatalf("ready 805 = %+v, err=%v, calls=%d", ready, svcerr, calls.Load())
		}
		prompt := gotUser.Load().(string)
		if !strings.Contains(prompt, "茄子蛋") {
			t.Fatalf("expected artist metadata in prompt: %s", prompt)
		}
		if ready.Lang != "other" || len(ready.Lines) != 2 || ready.Lines[1].Lang != "other" {
			t.Fatalf("expected Hokkien Tâi-lô with lang=other, got %+v", ready)
		}
	})
}

func TestStreamLyricPronunciationsSingleProducerAndReplay(t *testing.T) {
	tracks := []dto.MusicTrackDto{
		{ID: 806, Name: "夢を叶えて", Artists: []string{"Singer"}},
	}
	setupMusicTranslationEnv(t, tracks)

	yrc := "[0,3000](0,1000,0)夢(1000,1000,0)を(2000,1000,0)見(2500,500,0)た\n" +
		"[3500,3000](3500,1500,0)風(5000,1500,0)が\n" +
		"[7000,3000](7000,1500,0)空(8500,1500,0)へ\n"
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data:    &dto.MusicLyricDto{Yrc: lyricPart(yrc)},
			outcome: lyricOutcomeHit,
		},
	})

	origPtr := lyricPronunciations
	origRetry := lyricTranslationRetryDelay
	lyricTranslationRetryDelay = 0
	var calls atomic.Int32
	doneCh := make(chan struct{}, 4)
	firstSent := make(chan struct{}, 1)
	releaseTail := make(chan struct{})

	svc := lyricPronunciationService{
		name:        "test_pron_stream_" + t.Name(),
		limiter:     &llmclient.Limiter{},
		concurrency: func() int { return 2 },
		stream: func(_ context.Context, _ tools.AIConfig, _, _ string, onChunk func(content string) error) error {
			calls.Add(1)
			if err := onChunk(`{"i":1,"lang":"ja","pronunciation":"yume o mita","tokens":["yume","o","mi","ta"]}` + "\n"); err != nil {
				return err
			}
			select {
			case firstSent <- struct{}{}:
			default:
			}
			<-releaseTail
			return onChunk(
				`{"i":2,"lang":"ja","pronunciation":"kaze ga","tokens":["kaze","ga"]}` + "\n" +
					`{"i":3,"lang":"ja","pronunciation":"sora e","tokens":["sora","e"]}` + "\n",
			)
		},
		done: func() { doneCh <- struct{}{} },
	}
	lyricPronunciations = &svc
	t.Cleanup(func() {
		lyricPronunciations = origPtr
		lyricTranslationRetryDelay = origRetry
	})

	type ev struct {
		name string
		raw  string
	}
	consume := func(onEv func(string)) ([]ev, *errs.ServiceError) {
		var mu sync.Mutex
		var out []ev
		svcerr := NewMusicService().StreamLyricPronunciations(
			context.Background(),
			806,
			"ncm-yrc",
			func() {},
			func(event string, data any) error {
				raw, _ := json.Marshal(data)
				mu.Lock()
				out = append(out, ev{name: event, raw: string(raw)})
				mu.Unlock()
				if onEv != nil {
					onEv(event)
				}
				return nil
			},
		)
		return out, svcerr
	}

	c1GotFirst := make(chan struct{}, 1)
	var c1Events, c2Events []ev
	var c1Err, c2Err *errs.ServiceError
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		c1Events, c1Err = consume(func(name string) {
			if name == "line" || name == "replay" {
				select {
				case c1GotFirst <- struct{}{}:
				default:
				}
			}
		})
	}()

	<-firstSent
	<-c1GotFirst

	c2Replayed := make(chan struct{}, 1)
	wg.Add(1)
	go func() {
		defer wg.Done()
		c2Events, c2Err = consume(func(name string) {
			if name == "replay" {
				select {
				case c2Replayed <- struct{}{}:
				default:
				}
			}
		})
	}()

	<-c2Replayed
	close(releaseTail)
	<-doneCh
	wg.Wait()

	if calls.Load() != 1 || c1Err != nil || c2Err != nil {
		t.Fatalf("calls=%d c1Err=%v c2Err=%v", calls.Load(), c1Err, c2Err)
	}
	if len(c1Events) != 4 {
		t.Fatalf("expected c1 3 line + 1 done, got %+v", c1Events)
	}
	var replay []dto.MusicLyricPronunciationLine
	var c2Lines []dto.MusicLyricPronunciationLine
	for _, item := range c2Events {
		switch item.name {
		case "replay":
			_ = json.Unmarshal([]byte(item.raw), &replay)
		case "line":
			var ln dto.MusicLyricPronunciationLine
			_ = json.Unmarshal([]byte(item.raw), &ln)
			c2Lines = append(c2Lines, ln)
		}
	}
	if len(replay) != 1 || len(c2Lines) != 2 || len(replay[0].Tokens) != 4 || c2Lines[1].Pronunciation != "sora e" {
		t.Fatalf("unexpected c2 replay/lines: replay=%+v lines=%+v", replay, c2Lines)
	}
}
