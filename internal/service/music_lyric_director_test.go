package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/llmclient"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func stubLyricDirectorAndTranslation(
	t *testing.T,
	directorFn func(system, user string) (string, error),
	transFn func(system, user string) (string, error),
) (*atomic.Int32, *atomic.Int32, func()) {
	t.Helper()
	origDir := lyricDirectors
	origTrans := lyricTranslations
	origDirRetry := lyricDirectorRetryDelay
	origTransRetry := lyricTranslationRetryDelay
	lyricDirectorRetryDelay = 0
	lyricTranslationRetryDelay = 0

	var dirCalls, transCalls atomic.Int32
	done := make(chan struct{}, 16)

	dirSvc := &lyricDirectorService{
		name:        "lyric_director",
		limiter:     &llmclient.Limiter{},
		concurrency: func() int { return 1 },
		complete: func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
			dirCalls.Add(1)
			return directorFn(system, user)
		},
	}
	transSvc := &lyricTranslationService{
		name:        "lyric_translation",
		limiter:     &llmclient.Limiter{},
		director:    dirSvc,
		concurrency: func() int { return 1 },
		complete: func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
			transCalls.Add(1)
			return transFn(system, user)
		},
		done: func() { done <- struct{}{} },
	}
	lyricDirectors = dirSvc
	lyricTranslations = transSvc

	t.Cleanup(func() {
		lyricDirectors = origDir
		lyricTranslations = origTrans
		lyricDirectorRetryDelay = origDirRetry
		lyricTranslationRetryDelay = origTransRetry
	})

	wait := func() {
		t.Helper()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("lyric translation job did not finish")
		}
	}
	return &dirCalls, &transCalls, wait
}

func TestLyricTranslationRouterExpertStage1AndStage2(t *testing.T) {
	track := dto.MusicTrackDto{
		ID:      601,
		Name:    "琵琶行",
		Artists: []string{"白居易", "汪苏泷"},
		Album:   "唐诗新韵",
		Aliases: []string{"古风诗词融合", "叙事长诗"},
	}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data: &dto.MusicLyricDto{
				Lrc: lyricPart("[00:01.00]五陵年少争缠头\n[00:05.00]朝成青丝暮成雪\n[00:09.00]弟走从军阿姨死\n[00:13.00]汪：我是米开朗基罗\n"),
			},
			outcome: lyricOutcomeHit,
		},
	})

	var stage1System, stage1User, stage2System, stage2User atomic.Value
	dirCalls, transCalls, wait := stubLyricDirectorAndTranslation(
		t,
		func(system, user string) (string, error) {
			stage1System.Store(system)
			stage1User.Store(user)
			return `{
  "genre": "classical_poetry_opera_fusion",
  "mood": "melancholic longing, wistful grandeur",
  "cultural_notes": [
    {"term": "五陵年少", "metonymy_meaning": "wealthy noble youth of the capital, NOT five tombs"},
    {"term": "青丝", "metonymy_meaning": "youth and jet-black hair, NOT green silk thread"},
    {"term": "阿姨", "metonymy_meaning": "foster madam of the music quarters in Tang context, NOT biological aunt"}
  ],
  "custom_style_skills": [
    "Preserve Tang poetic cadence with parallel imagery and elegiac grace",
    "Shift cleanly to playful conversational intimacy when modern duet dialogue enters"
  ],
  "translation_directive": "Use elevated literary English for Classical lines while keeping duet dialogue natural",
  "visual_theme": "floating amber lotus petals on misty river"
}`, nil
		},
		func(system, user string) (string, error) {
			stage2System.Store(system)
			stage2User.Store(user)
			return `{"lines":[{"i":1,"t":"Wealthy noble youths of the capital vied to shower silk"},{"i":2,"t":"Jet-black hair at dawn turned white as snow by dusk"},{"i":3,"t":"Her brother marched to war, and her foster madam passed away"},{"i":4,"t":"I am Michelangelo"}]}`, nil
		},
	)

	s := NewMusicService()
	ctx := context.Background()
	res, svcerr := s.GetLyricTranslations(ctx, 601, "ncm-lrc", "en")
	if svcerr != nil || res.Status != "pending" {
		t.Fatalf("first get = %+v, err=%v", res, svcerr)
	}
	wait()

	if dirCalls.Load() != 1 || transCalls.Load() != 1 {
		t.Fatalf("expected 1 Stage 1 call and 1 Stage 2 call, got dir=%d trans=%d", dirCalls.Load(), transCalls.Load())
	}

	s1Sys := stage1System.Load().(string)
	if !strings.Contains(s1Sys, "master music director") || !strings.Contains(s1Sys, `"custom_style_skills"`) {
		t.Fatalf("unexpected Stage 1 system prompt: %s", s1Sys)
	}
	s1Usr := stage1User.Load().(string)
	for _, want := range []string{"琵琶行", "白居易", "唐诗新韵", "古风诗词融合", "五陵年少争缠头", "汪：我是米开朗基罗"} {
		if !strings.Contains(s1Usr, want) {
			t.Fatalf("Stage 1 user prompt missing %q: %s", want, s1Usr)
		}
	}

	s2Sys := stage2System.Load().(string)
	for _, want := range []string{
		"=== SONG DIRECTOR BLUEPRINT (from Stage 1) ===",
		"Genre: classical_poetry_opera_fusion",
		"Dominant Mood: melancholic longing, wistful grandeur",
		"Overall Directive: Use elevated literary English for Classical lines while keeping duet dialogue natural",
		"五陵年少: wealthy noble youth of the capital, NOT five tombs",
		"青丝: youth and jet-black hair, NOT green silk thread",
		"阿姨: foster madam of the music quarters in Tang context, NOT biological aunt",
		"Preserve Tang poetic cadence with parallel imagery and elegiac grace",
		"Shift cleanly to playful conversational intimacy when modern duet dialogue enters",
		"=== CORE FOUNDATION RULES ===",
		"4. Stripping Speaker Cues",
		"5. Cross-line Clause Linking",
	} {
		if !strings.Contains(s2Sys, want) {
			t.Fatalf("Stage 2 system prompt missing %q:\n%s", want, s2Sys)
		}
	}

	s2Usr := stage2User.Load().(string)
	if !strings.Contains(s2Usr, "汪：我是米开朗基罗") {
		t.Fatalf("Stage 2 user prompt missing original line: %s", s2Usr)
	}

	ready, svcerr := s.GetLyricTranslations(ctx, 601, "ncm-lrc", "en")
	if svcerr != nil || ready.Status != "ready" || len(ready.Lines) != 4 {
		t.Fatalf("ready = %+v, err=%v", ready, svcerr)
	}
	if ready.Lines[3].Translation != "I am Michelangelo" {
		t.Fatalf("duet speaker cue should be stripped in translation, got %q", ready.Lines[3].Translation)
	}
}

func TestLyricDirectorCrossLanguageCacheAndForceRefresh(t *testing.T) {
	track := dto.MusicTrackDto{
		ID:      602,
		Name:    "千年谣",
		Artists: []string{"歌者"},
	}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data: &dto.MusicLyricDto{
				Lrc: lyricPart("[00:01.00]五陵年少争缠头\n[00:05.00]月落乌啼霜满天\n"),
			},
			outcome: lyricOutcomeHit,
		},
	})

	var mu sync.Mutex
	var stage2Systems []string
	var version atomic.Int32
	dirCalls, transCalls, wait := stubLyricDirectorAndTranslation(
		t,
		func(_, _ string) (string, error) {
			v := version.Add(1)
			return fmt.Sprintf(`{
  "genre": "classical_poetry_v%d",
  "mood": "serene nostalgia",
  "cultural_notes": [{"term": "五陵年少", "metonymy_meaning": "wealthy noble youth v%d"}],
  "custom_style_skills": ["Custom skill v%d"],
  "translation_directive": "Keep concise poetic balance",
  "visual_theme": "warm lantern glow over autumn frost"
}`, v, v, v), nil
		},
		func(system, user string) (string, error) {
			mu.Lock()
			stage2Systems = append(stage2Systems, system)
			mu.Unlock()
			var p struct {
				TargetLang string `json:"target_lang"`
			}
			_ = json.Unmarshal([]byte(user), &p)
			return fmt.Sprintf(`{"lines":[{"i":1,"t":"tr1-%s"},{"i":2,"t":"tr2-%s"}]}`, p.TargetLang, p.TargetLang), nil
		},
	)

	s := NewMusicService()
	ctx := context.Background()

	for _, lang := range []string{"en", "ja"} {
		res, svcerr := s.GetLyricTranslations(ctx, 602, "ncm-lrc", lang)
		if svcerr != nil || res.Status != "pending" {
			t.Fatalf("get(%s) = %+v, err=%v", lang, res, svcerr)
		}
		wait()
	}
	if dirCalls.Load() != 1 || transCalls.Load() != 2 {
		t.Fatalf("after en/ja: dir=%d (want 1), trans=%d (want 2)", dirCalls.Load(), transCalls.Load())
	}

	// 清空 sharedstate 内存键后再请求 ko，验证可从 DB lyric_directors 表直接命中缓存而不重调 Stage 1
	hash := computeLyricDirectorHash([]string{"五陵年少争缠头", "月落乌啼霜满天"})
	_ = sharedstate.Current().Delete(lyricDirectors.dataKey("602:" + hash))

	resKO, svcerr := s.GetLyricTranslations(ctx, 602, "ncm-lrc", "ko")
	if svcerr != nil || resKO.Status != "pending" {
		t.Fatalf("get(ko) = %+v, err=%v", resKO, svcerr)
	}
	wait()
	if dirCalls.Load() != 1 || transCalls.Load() != 3 {
		t.Fatalf("after DB fallback ko: dir=%d (want 1), trans=%d (want 3)", dirCalls.Load(), transCalls.Load())
	}

	mu.Lock()
	if len(stage2Systems) != 3 {
		mu.Unlock()
		t.Fatalf("expected 3 Stage 2 calls, got %d", len(stage2Systems))
	}
	for i, sys := range stage2Systems {
		if !strings.Contains(sys, "Genre: classical_poetry_v1") || !strings.Contains(sys, "Custom skill v1") {
			mu.Unlock()
			t.Fatalf("Stage 2 call %d did not receive cached v1 blueprint: %s", i, sys)
		}
	}
	mu.Unlock()

	// 管理员手动强刷：忽略已有缓存，必须重跑 Stage 1 并注入新版 Blueprint v2
	admin := &model.User{Username: "director-admin", Email: "da@example.com", Password: "x", Role: "admin"}
	if err := repo.GetDB().Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	adminCtx := context.WithValue(context.Background(), "user_id", admin.ID)
	refreshed, svcerr := s.RefreshLyricTranslations(adminCtx, 602, "ncm-lrc", "en")
	if svcerr != nil || refreshed.Status != lyricTranslationStatusReady || !refreshed.Stale {
		t.Fatalf("refresh = %+v, err=%v", refreshed, svcerr)
	}
	wait()

	if dirCalls.Load() != 2 || transCalls.Load() != 4 {
		t.Fatalf("after admin refresh: dir=%d (want 2), trans=%d (want 4)", dirCalls.Load(), transCalls.Load())
	}
	mu.Lock()
	lastSys := stage2Systems[len(stage2Systems)-1]
	mu.Unlock()
	if !strings.Contains(lastSys, "Genre: classical_poetry_v2") || !strings.Contains(lastSys, "Custom skill v2") {
		t.Fatalf("refreshed Stage 2 did not receive v2 blueprint: %s", lastSys)
	}

	// 验证 CleanupLyricDirectors 只清理超过 2*TTL 的旧记录，保留有效记录
	expired := &model.LyricDirector{
		SongID:    9999,
		LyricHash: "expired-hash",
		Data:      `{"genre":"old"}`,
		Model:     "test-model",
		CreatedAt: time.Now().Add(-30 * 24 * time.Hour),
	}
	if err := repo.GetDB().Create(expired).Error; err != nil {
		t.Fatal(err)
	}
	deleted, err := CleanupLyricDirectors(time.Now())
	if err != nil || deleted != 1 {
		t.Fatalf("CleanupLyricDirectors deleted=%d err=%v, want 1, nil", deleted, err)
	}
	var keptCount int64
	_ = repo.GetDB().Model(&model.LyricDirector{}).Where("song_id = ?", 602).Count(&keptCount).Error
	if keptCount != 1 {
		t.Fatalf("active song 602 director record count = %d, want 1", keptCount)
	}
}

func TestLyricDirectorVisualThemeLinkageToAnnotation(t *testing.T) {
	track := dto.MusicTrackDto{
		ID:      603,
		Name:    "琵琶行",
		Artists: []string{"白居易"},
		Album:   "江州司马",
	}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data:    &dto.MusicLyricDto{Lrc: lyricPart(pipaNCMLrc), Yrc: lyricPart(pipaNCMYrc)},
			outcome: lyricOutcomeHit,
		},
	})

	s := NewMusicService()
	ctx := context.Background()
	editor, svcerr := s.GetLyricAnnotationEditor(ctx, 603)
	if svcerr != nil || len(editor.Lines) == 0 {
		t.Fatalf("editor = %+v, err=%v", editor, svcerr)
	}
	lines := editor.Lines

	hash := computeLyricDirectorHash(lines)
	stateKey := "603:" + hash
	lyricDirectors.save(603, hash, stateKey, "test-model", lyricDirectorAnalysis{
		Genre:                "classical_poetry",
		Mood:                 "wistful melancholy",
		TranslationDirective: "Preserve elegiac tone",
		VisualTheme:          "floating amber lotus petals on misty river",
	}, 24*time.Hour)

	if got := lookupLyricDirectorVisualTheme(603, lines); got != "floating amber lotus petals on misty river" {
		t.Fatalf("lookupLyricDirectorVisualTheme = %q", got)
	}

	prompt := buildLyricAnnotationPrompt(lyricAnnotationInfo{
		Title:       track.Name,
		Artists:     track.Artists,
		Album:       track.Album,
		VisualTheme: lookupLyricDirectorVisualTheme(603, lines),
	}, lines)
	if !strings.Contains(prompt, "Director visual theme suggestion: floating amber lotus petals on misty river") {
		t.Fatalf("annotation prompt missing visual_theme linkage:\n%s", prompt)
	}

	// 验证真实 lyricAnnotationService.execute 会自动查库填入 VisualTheme 并传给规划模型
	origAnn := lyricAnnotations
	done := make(chan struct{}, 2)
	var capturedPlanUser atomic.Value
	lyricAnnotations = &lyricAnnotationService{
		name:        "lyric_annotation",
		limiter:     &llmclient.Limiter{},
		concurrency: func() int { return 1 },
		complete: func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
			if strings.Contains(system, "Task: plan the whole song.") {
				capturedPlanUser.Store(user)
				return `{"theme":"autumn longing","direction":"amber and lake tones","intro":"江州夜色","moments":[],"font":"song","spotlights":[0],"accent":"#ffb37a","imagery":[],"lines":[{"i":0,"mood":"sad","chorus_start":true,"scene":"petals"}]}`, nil
			}
			return `{"lines":[{"i":0,"phrases":[{"text":"浔阳江头","effect":"glow","color":"amber"}]}]}`, nil
		},
		done: func() { done <- struct{}{} },
	}
	t.Cleanup(func() { lyricAnnotations = origAnn })

	res, svcerr := s.GetLyricAnnotations(ctx, 603)
	if svcerr != nil || res.Status != "pending" {
		t.Fatalf("first GetLyricAnnotations = %+v, err=%v", res, svcerr)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("lyric annotation job did not finish")
	}
	planUser, _ := capturedPlanUser.Load().(string)
	if !strings.Contains(planUser, "Director visual theme suggestion: floating amber lotus petals on misty river") {
		t.Fatalf("lyricAnnotationService.execute did not inject Stage 1 visual_theme:\n%s", planUser)
	}
}

func TestDynamicThinkingConfigPropagation(t *testing.T) {
	setupMusicTranslationEnv(t, nil)

	type reqRecord struct {
		stream          bool
		hasEffort       bool
		reasoningEffort string
	}
	var mu sync.Mutex
	var recorded []reqRecord

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		stream, _ := body["stream"].(bool)
		effort, hasEffort := body["reasoning_effort"].(string)
		mu.Lock()
		recorded = append(recorded, reqRecord{
			stream:          stream,
			hasEffort:       hasEffort,
			reasoningEffort: effort,
		})
		mu.Unlock()
		if stream {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n")
			_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}`)
	}))
	defer srv.Close()

	for k, v := range map[string]any{
		"ai_api_base_url":                 srv.URL,
		"ai_api_key":                      "sk-test",
		"ai_model":                        "thinking-prop-model",
		"ai_thinking_lyric_translation":   "",
		"ai_thinking_lyric_annotation":    "none",
		"ai_thinking_lyric_pronunciation": "low",
		"ai_thinking_writing":             "medium",
		"ai_thinking_comment_translate":   "high",
		"ai_thinking_summary":             "medium",
	} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatalf("set kv %s: %v", k, err)
		}
	}

	cfg := tools.GetAIConfig()
	ctx := context.Background()

	// 1. ai_thinking_lyric_translation = "" (不传 reasoning_effort)
	if _, err := lyricTranslations.complete(ctx, cfg, "sys", "usr"); err != nil {
		t.Fatalf("lyricTranslations.complete failed: %v", err)
	}
	// 2. ai_thinking_lyric_annotation = "none"
	if _, err := lyricAnnotations.complete(ctx, cfg, "sys", "usr"); err != nil {
		t.Fatalf("lyricAnnotations.complete failed: %v", err)
	}
	// 3. ai_thinking_lyric_pronunciation = "low"
	if _, err := lyricPronunciations.complete(ctx, cfg, "sys", "usr"); err != nil {
		t.Fatalf("lyricPronunciations.complete failed: %v", err)
	}
	// 4. ai_thinking_writing = "medium" (流式写作 + 标题元数据非流式均读取该配置)
	if err := aiWriteService.stream(ctx, cfg, "sys", "usr", func(_, _ string) error { return nil }); err != nil {
		t.Fatalf("aiWriteService.stream failed: %v", err)
	}
	if _, err := aiWriteService.complete(ctx, cfg, "sys", "usr", 0.3, tools.GetAIWritingThinking()); err != nil {
		t.Fatalf("aiWriteService.complete failed: %v", err)
	}
	// 5. ai_thinking_comment_translate = "high"
	if _, err := commentTranslateCompletion(ctx, cfg, "sys", "usr"); err != nil {
		t.Fatalf("commentTranslateCompletion failed: %v", err)
	}
	// 6. ai_thinking_summary = "medium"
	if _, err := aiSummaryCompletion(ctx, cfg, "sys", "usr", nil); err != nil {
		t.Fatalf("aiSummaryCompletion failed: %v", err)
	}
	// 7. Stage 1 Router Agent 始终固定使用 "none"
	if _, err := lyricDirectors.complete(ctx, cfg, "sys", "usr"); err != nil {
		t.Fatalf("lyricDirectors.complete failed: %v", err)
	}
	// 验证配置支持动态切换
	if err := repo.KV.SetKV("ai_thinking_lyric_translation", "high"); err != nil {
		t.Fatalf("update ai_thinking_lyric_translation: %v", err)
	}
	if _, err := lyricTranslations.complete(ctx, cfg, "sys", "usr"); err != nil {
		t.Fatalf("lyricTranslations.complete after update failed: %v", err)
	}

	want := []reqRecord{
		{stream: false, hasEffort: false, reasoningEffort: ""},
		{stream: false, hasEffort: true, reasoningEffort: "none"},
		{stream: false, hasEffort: true, reasoningEffort: "low"},
		{stream: true, hasEffort: true, reasoningEffort: "medium"},
		{stream: false, hasEffort: true, reasoningEffort: "medium"},
		{stream: false, hasEffort: true, reasoningEffort: "high"},
		{stream: false, hasEffort: true, reasoningEffort: "medium"},
		{stream: false, hasEffort: true, reasoningEffort: "none"},
		{stream: false, hasEffort: true, reasoningEffort: "high"},
	}
	mu.Lock()
	defer mu.Unlock()
	if len(recorded) != len(want) {
		t.Fatalf("recorded %d requests, want %d: %+v", len(recorded), len(want), recorded)
	}
	for i := range want {
		if recorded[i] != want[i] {
			t.Fatalf("request %d = %+v, want %+v", i, recorded[i], want[i])
		}
	}
}

func TestDirectorNeedsReferenceTranslationForAbstractAndMorseLyrics(t *testing.T) {
	if !strings.Contains(lyricDirectorSystemPrompt, `"needs_reference_translation"`) ||
		!strings.Contains(lyricDirectorSystemPrompt, "Morse code") ||
		!strings.Contains(lyricDirectorSystemPrompt, "LaVI-Bavellabion") {
		t.Fatalf("Stage 1 prompt missing needs_reference_translation guidance:\n%s", lyricDirectorSystemPrompt)
	}

	// 验证纯省略号 "..." 与分隔线 "---" 仍会被跳过，而真摩斯电码保留且生成唯一键
	for _, noise := range []string{"...", "---", "//"} {
		if isMorseLikeLine(noise) {
			t.Fatalf("noise %q should not be treated as Morse code", noise)
		}
		if _, skip, _ := classifyLyricTranslationLine(noise); !skip {
			t.Fatalf("noise %q should be skipped by classifyLyricTranslationLine", noise)
		}
	}
	for _, morse := range []string{"... --- ...", ".- / -..."} {
		if !isMorseLikeLine(morse) {
			t.Fatalf("morse %q should be detected as Morse code", morse)
		}
		if vocal, skip, _ := classifyLyricTranslationLine(morse); skip || vocal != morse {
			t.Fatalf("morse %q classify = (%q, %v), want keep", morse, vocal, skip)
		}
		if songAlreadyInTargetLang([]string{morse}, "zh") {
			t.Fatalf("morse song %q must not be short-circuited as same language", morse)
		}
	}

	// 验证 filterTargetLangReference 在双语组合 "zh+en" 下只剥离目标语言、保留外语参考
	dualTasks := []lyricTranslationLineTask{
		{Index: 1, OrigText: "君の名前を呼んでいる", VocalText: "君の名前を呼んでいる", RefText: "[zh] 呼唤你的名字 | [en] Calling your name"},
	}
	effLang, effRefs := filterTargetLangReference("zh+en", "zh", dualTasks, false)
	if effLang != "en" || len(effRefs) != 1 || effRefs[0] != "Calling your name" {
		t.Fatalf("filterTargetLangReference(zh+en -> zh, keep=false) = (%q, %v)", effLang, effRefs)
	}
	effLangKeep, effRefsKeep := filterTargetLangReference("zh+en", "zh", dualTasks, true)
	if effLangKeep != "zh+en" || effRefsKeep[0] != dualTasks[0].RefText {
		t.Fatalf("filterTargetLangReference(zh+en -> zh, keep=true) = (%q, %v)", effLangKeep, effRefsKeep)
	}

	// 场景 1：常规日语歌已有内置中文，管理员强制重译 AI 中文（zh）时不携带内置中文 ref，而翻英文（en）时保留中文 ref
	normalTrack := dto.MusicTrackDto{ID: 604, Name: "Normal Song", Artists: []string{"Artist"}}
	// 场景 2：摩斯电码 + 架空造语歌已有内置中文，Stage 1 判定 needs_reference_translation=true，重译 zh 时必须保留 ref
	abstractTrack := dto.MusicTrackDto{ID: 605, Name: "Cipher Signal", Artists: []string{"Conlang"}}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{normalTrack, abstractTrack})

	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data: &dto.MusicLyricDto{
				Lrc:    lyricPart("[00:01.00]... --- ...\n[00:05.00].- / -...\n[00:09.00]LaVI-Bavellabion\n"),
				Tlyric: lyricPart("[00:01.00]紧急求救信号\n[00:05.00]暗码启程\n[00:09.00]圣光启迪万物\n"),
			},
			outcome: lyricOutcomeHit,
		},
	})

	var mu sync.Mutex
	var capturedStage1Users []string
	var capturedStage2Systems []string
	var capturedStage2Users []string

	_, _, wait := stubLyricDirectorAndTranslation(
		t,
		func(_, user string) (string, error) {
			mu.Lock()
			capturedStage1Users = append(capturedStage1Users, user)
			mu.Unlock()
			if strings.Contains(user, "... --- ...") || strings.Contains(user, "LaVI-Bavellabion") {
				return `{
  "genre": "experimental_conlang_morse",
  "mood": "cryptic solemn urgent",
  "needs_reference_translation": true,
  "cultural_notes": [{"term": "... --- ...", "metonymy_meaning": "SOS distress signal"}],
  "custom_style_skills": ["Decode Morse/conlang lines naturally using the guide"],
  "translation_directive": "Consult reference meaning and render poetic Chinese",
  "visual_theme": "static radio waves over starfield"
}`, nil
			}
			return `{
  "genre": "jpop_ballad",
  "mood": "gentle nostalgic",
  "needs_reference_translation": false,
  "cultural_notes": [],
  "custom_style_skills": ["Translate cleanly from original phrasing"],
  "translation_directive": "Keep delicate lyrical flow",
  "visual_theme": "soft twilight mist"
}`, nil
		},
		func(system, user string) (string, error) {
			mu.Lock()
			capturedStage2Systems = append(capturedStage2Systems, system)
			capturedStage2Users = append(capturedStage2Users, user)
			mu.Unlock()
			if strings.Contains(user, `"title":"Cipher Signal"`) {
				return `{"lines":[{"i":1,"t":"发往星海的求救电波"},{"i":2,"t":"破译暗码启程远航"},{"i":3,"t":"圣光拂晓唤醒万灵"}]}`, nil
			}
			if strings.Contains(user, `"target_lang":"en `) {
				return `{"lines":[{"i":1,"t":"Calling your name tonight"},{"i":2,"t":"Till dawn paints the sky"}]}`, nil
			}
			return `{"lines":[{"i":1,"t":"今夜呼唤你的名字"},{"i":2,"t":"直到晨曦染红天际"}]}`, nil
		},
	)

	s := NewMusicService()
	ctx := context.Background()

	// 先跑摩斯电码+造语抽象歌词的 zh AI 生成：Stage 1 与 Stage 2 必须完整收到摩斯电码行与内置中文参考
	abstractRefresh, svcerr := s.RefreshLyricTranslations(ctx, 605, "ncm-lrc", "zh")
	if svcerr != nil || abstractRefresh.Status != lyricTranslationStatusPending {
		t.Fatalf("abstract RefreshLyricTranslations = %+v, err=%v", abstractRefresh, svcerr)
	}
	wait()

	abstractReady, svcerr := s.GetLyricTranslations(ctx, 605, "ncm-lrc", "zh")
	if svcerr != nil || abstractReady.Status != lyricTranslationStatusReady || len(abstractReady.Lines) != 3 {
		t.Fatalf("abstract ready = %+v, err=%v", abstractReady, svcerr)
	}
	if abstractReady.Lines[0].Text != "... --- ..." || abstractReady.Lines[0].Translation != "发往星海的求救电波" ||
		abstractReady.Lines[1].Text != ".- / -..." || abstractReady.Lines[1].Translation != "破译暗码启程远航" {
		t.Fatalf("unexpected morse line translations: %+v", abstractReady.Lines)
	}

	// 再切换数据源为常规日语歌，验证 zh 覆盖不带内置中文 ref，而 en 保留中文 ref
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data: &dto.MusicLyricDto{
				Lrc:    lyricPart("[00:01.00]君の名前を呼んでいる\n[00:05.00]夜明けの空が染まるまで\n"),
				Tlyric: lyricPart("[00:01.00]原版呼唤你的名字\n[00:05.00]原版直到天色染红\n"),
			},
			outcome: lyricOutcomeHit,
		},
	})
	normalZhRefresh, svcerr := s.RefreshLyricTranslations(ctx, 604, "ncm-lrc", "zh")
	if svcerr != nil || normalZhRefresh.Status != lyricTranslationStatusPending {
		t.Fatalf("normal zh refresh = %+v, err=%v", normalZhRefresh, svcerr)
	}
	wait()

	normalEn, svcerr := s.GetLyricTranslations(ctx, 604, "ncm-lrc", "en")
	if svcerr != nil || normalEn.Status != lyricTranslationStatusPending {
		t.Fatalf("normal en = %+v, err=%v", normalEn, svcerr)
	}
	wait()

	mu.Lock()
	defer mu.Unlock()
	if len(capturedStage1Users) != 2 || !strings.Contains(capturedStage1Users[0], "... --- ...") {
		t.Fatalf("expected 2 Stage 1 calls (cross-lang reused cache) with Morse line in first, got %v", capturedStage1Users)
	}
	if len(capturedStage2Users) != 3 {
		t.Fatalf("expected 3 Stage 2 prompts, got %d", len(capturedStage2Users))
	}
	// [0]: abstract zh -> 含 ref_lang:zh、紧急求救信号 与 Reference Policy
	if !strings.Contains(capturedStage2Users[0], `"ref_lang":"zh"`) ||
		!strings.Contains(capturedStage2Users[0], `"ref":"紧急求救信号"`) ||
		!strings.Contains(capturedStage2Systems[0], "Reference Policy:") {
		t.Fatalf("abstract zh prompt should retain ref & policy:\nsys=%s\nuser=%s", capturedStage2Systems[0], capturedStage2Users[0])
	}
	// [1]: normal zh -> 不含 ref_lang 与内置中文 ref
	if strings.Contains(capturedStage2Users[1], "原版呼唤你的名字") ||
		strings.Contains(capturedStage2Users[1], `"ref_lang"`) ||
		strings.Contains(capturedStage2Systems[1], "Reference Policy:") {
		t.Fatalf("normal zh override must strip same-language ref:\nsys=%s\nuser=%s", capturedStage2Systems[1], capturedStage2Users[1])
	}
	// [2]: normal en -> 跨语种翻译仍保留中文 ref 供模型参考
	if !strings.Contains(capturedStage2Users[2], `"ref_lang":"zh"`) ||
		!strings.Contains(capturedStage2Users[2], `"ref":"原版呼唤你的名字"`) {
		t.Fatalf("normal cross-language en translation should keep zh ref: %s", capturedStage2Users[2])
	}
}
