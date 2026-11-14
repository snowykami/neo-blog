package service

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
)

func stubSongTranslationService(t *testing.T, fn func(system, user string) (string, error)) (*atomic.Int32, func()) {
	t.Helper()
	origPtr := songTranslations
	done := make(chan struct{}, 8)
	var calls atomic.Int32

	svc := *origPtr
	svc.name = "test_song_tr_" + t.Name()
	svc.limiter = &llmclient.Limiter{}
	svc.complete = func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
		calls.Add(1)
		return fn(system, user)
	}
	svc.done = func() { done <- struct{}{} }
	songTranslations = &svc
	t.Cleanup(func() {
		songTranslations = origPtr
	})
	wait := func() {
		t.Helper()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("song translation job did not finish")
		}
	}
	return &calls, wait
}

func TestSongMetaSameLangAndNCMHints(t *testing.T) {
	tracks := []dto.MusicTrackDto{
		{ID: 601, Name: "晴天", Artists: []string{"周杰伦"}},
		{ID: 602, Name: "Lemon", Artists: []string{"米津玄師"}},
	}
	setupMusicTranslationEnv(t, tracks)

	storeSongHints(602, []string{"柠檬"}, [][]string{{"米津玄师", "Kenshi Yonezu"}})

	var gotUser atomic.Value
	calls, wait := stubSongTranslationService(t, func(_, user string) (string, error) {
		gotUser.Store(user)
		return `{"title":"Lemon","artists":["米津玄师"]}`, nil
	})

	s := NewMusicService()
	ctx := context.Background()

	// 同语种中文曲名+歌手在 zh 下直接返回 same_language=true，不调用 LLM
	zhSame, svcerr := s.GetSongTranslationMeta(ctx, 601, "zh")
	if svcerr != nil || zhSame.Status != "ready" || !zhSame.SameLanguage || calls.Load() != 0 {
		t.Fatalf("same lang zh = %+v, err=%v, calls=%d", zhSame, svcerr, calls.Load())
	}

	// 外文歌曲在 zh 下触发后台翻译，并把网易云官方 aliases / tns hints 传入 prompt
	first, svcerr := s.GetSongTranslationMeta(ctx, 602, "zh")
	if svcerr != nil || first.Status != "pending" {
		t.Fatalf("first get = %+v, err=%v", first, svcerr)
	}
	wait()

	prompt := gotUser.Load().(string)
	if !strings.Contains(prompt, "柠檬") || !strings.Contains(prompt, "Kenshi Yonezu") {
		t.Fatalf("expected NCM hints in prompt: %s", prompt)
	}

	ready, svcerr := s.GetSongTranslationMeta(ctx, 602, "zh")
	if svcerr != nil || ready.Status != "ready" || ready.SameLanguage || len(ready.Artists) != 1 || ready.Artists[0] != "米津玄师" {
		t.Fatalf("ready = %+v, err=%v", ready, svcerr)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 LLM call, got %d", calls.Load())
	}

	// 第二次读取应直接命中数据库缓存
	cached, svcerr := s.GetSongTranslationMeta(ctx, 602, "zh")
	if svcerr != nil || cached.Status != "ready" || calls.Load() != 1 {
		t.Fatalf("expected cached hit without extra LLM call: %+v, calls=%d", cached, calls.Load())
	}

	// 管理员手动刷新返回 ready + stale，并覆盖写入新译名
	admin := &model.User{Username: "admin_song_tr", Email: "ast@example.com", Password: "x", Role: "admin"}
	if err := repo.GetDB().Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	adminCtx := context.WithValue(context.Background(), "user_id", admin.ID)
	refreshed, svcerr := s.RefreshSongTranslationMeta(adminCtx, 602, "zh")
	if svcerr != nil || refreshed.Status != "ready" || !refreshed.Stale {
		t.Fatalf("refresh = %+v, err=%v", refreshed, svcerr)
	}
	wait()
	if calls.Load() != 2 {
		t.Fatalf("expected 2 LLM calls after refresh, got %d", calls.Load())
	}
}

func TestParseAndValidateSongTranslationResp(t *testing.T) {
	if !songMetaAlreadyInTargetLang("晴天", []string{"周杰伦"}, "zh") {
		t.Fatal("simplified song meta should match zh")
	}
	if songMetaAlreadyInTargetLang("晴天", []string{"周杰倫"}, "zh-hk") {
		t.Fatal("simplified song title should not skip zh-hk")
	}

	// 模型未按目标语种脚本返回时（如 en 目标返回纯中文）应被 isValidSongMetaScript / sanitize 过滤为空
	title, artists, err := parseSongTranslationResponse(
		`{"title":"你好世界","artists":["周杰伦"]}`,
		"Hello World",
		[]string{"Jay Chou"},
		"en",
	)
	if err != nil {
		t.Fatalf("parseSongTranslationResponse err = %v", err)
	}
	if title != "" || len(artists) != 1 || artists[0] != "" {
		t.Fatalf("expected invalid script translations filtered, got title=%q artists=%+v", title, artists)
	}

	title2, artists2, err := parseSongTranslationResponse(
		`{"title":"ハロー・ワールド","artists":["ジェイ・チョウ"]}`,
		"Hello World",
		[]string{"Jay Chou"},
		"ja",
	)
	if err != nil {
		t.Fatalf("parseSongTranslationResponse ja err = %v", err)
	}
	if title2 != "ハロー・ワールド" || len(artists2) != 1 || artists2[0] != "ジェイ・チョウ" {
		t.Fatalf("valid ja meta = (%q, %+v)", title2, artists2)
	}
}
