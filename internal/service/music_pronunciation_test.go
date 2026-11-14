package service

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/tools"
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
