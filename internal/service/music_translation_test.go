package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
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

func setupMusicTranslationEnv(t *testing.T, tracks []dto.MusicTrackDto) {
	t.Helper()
	setupTTMLDB(t)
	resetLyricSharedState(t)

	for k, v := range map[string]any{
		"ai_api_base_url":  "https://example.com/v1",
		"ai_api_key":       "sk-test",
		"ai_model":         "test-model",
		"ncm_api_base_url": "https://ncm.example.com",
		"ncm_playlist_id":  12345,
	} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatalf("set kv %s: %v", k, err)
		}
	}

	cfg := tools.GetNCMConfig()
	key := cfg.BaseURL + "\n" + cfg.Cookie + "\n" + "12345"
	if cfg.PlaylistID != 12345 {
		t.Fatalf("unexpected playlist id %d", cfg.PlaylistID)
	}
	storePlaylist(key, tracks)
	invalidateArticleSongs()

	t.Cleanup(func() {
		musicState.Lock()
		musicState.key = ""
		musicState.tracks = nil
		musicState.fetchedAt = time.Time{}
		musicState.Unlock()
		invalidateArticleSongs()
	})
}

func stubLyricTranslationService(t *testing.T, fn func(system, user string) (string, error)) (*atomic.Int32, func()) {
	t.Helper()
	orig := lyricTranslations
	origRetry := lyricTranslationRetryDelay
	lyricTranslationRetryDelay = 0
	done := make(chan struct{}, 8)
	var calls atomic.Int32

	svc := &lyricTranslationService{
		limiter:     &llmclient.Limiter{},
		concurrency: func() int { return 1 },
		complete: func(_ context.Context, _ tools.AIConfig, system, user string) (string, error) {
			calls.Add(1)
			return fn(system, user)
		},
		done: func() { done <- struct{}{} },
	}
	lyricTranslations = svc
	t.Cleanup(func() {
		lyricTranslations = orig
		lyricTranslationRetryDelay = origRetry
	})
	wait := func() {
		t.Helper()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("lyric translation job did not finish")
		}
	}
	return &calls, wait
}

func TestLyricTranslationLanguageDetection(t *testing.T) {
	if got := normalizeLyricLangTag("zh-Hant-TW"); got != "zh-tw" {
		t.Fatalf("zh-Hant-TW = %q", got)
	}
	if got := normalizeLyricLangTag("zh_CN"); got != "zh" {
		t.Fatalf("zh_CN = %q", got)
	}
	if got := normalizeLyricLangTag("ja-Latn"); got != "" {
		t.Fatalf("ja-Latn = %q, want empty", got)
	}
	if got := detectLyricTextLang([]string{"今天天氣真好，我們一起出發吧", "這是一段繁體中文測試"}, "zh"); got != "zh-tw" {
		t.Fatalf("traditional tagged zh = %q, want zh-tw", got)
	}
	if got := detectLyricTextLang([]string{"Hello world, I know you are there", "When the night falls on the city"}, "zh"); got != "en" {
		t.Fatalf("mis-tagged english = %q, want en", got)
	}
	if got := detectLyricTextLang([]string{"夜に駆ける君と僕"}, ""); got != "ja" {
		t.Fatalf("japanese = %q", got)
	}
	if got := detectLyricTextLang([]string{"사랑해 너를 기억해"}, ""); got != "ko" {
		t.Fatalf("korean = %q", got)
	}
}

func TestClassifyLyricVocalLineAndPrefix(t *testing.T) {
	artists := []string{"李荣浩", "可莉 (花玲)"}

	if _, skip := classifyLyricVocalLine("李荣浩：", artists); !skip {
		t.Fatal("standalone artist cue should be skipped")
	}
	if _, skip := classifyLyricVocalLine("女：", artists); !skip {
		t.Fatal("standalone role cue should be skipped")
	}
	if _, skip := classifyLyricVocalLine("[Chorus]", artists); !skip {
		t.Fatal("section header should be skipped")
	}
	if _, skip := classifyLyricVocalLine("作词：方文山", artists); !skip {
		t.Fatal("credit line should be skipped")
	}
	if _, skip := classifyLyricVocalLine("纯音乐，请欣赏", artists); !skip {
		t.Fatal("instrumental line should be skipped")
	}

	vocal, skip := classifyLyricVocalLine("李荣浩：如果有一天我回到从前", artists)
	if skip || vocal != "如果有一天我回到从前" {
		t.Fatalf("artist prefix = (%q, %v)", vocal, skip)
	}
	vocal, skip = classifyLyricVocalLine("花玲：烦恼都走开", artists)
	if skip || vocal != "烦恼都走开" {
		t.Fatalf("sub-artist prefix = (%q, %v)", vocal, skip)
	}
	vocal, skip = classifyLyricVocalLine("女：你在我身边", artists)
	if skip || vocal != "你在我身边" {
		t.Fatalf("role prefix = (%q, %v)", vocal, skip)
	}
	// 普通歌词中出现较晚或非歌手名的冒号不应误判为歌手提示
	vocal, skip = classifyLyricVocalLine("她问我：你明天还会回来吗", artists)
	if skip || vocal != "她问我：你明天还会回来吗" {
		t.Fatalf("ordinary colon lyric = (%q, %v)", vocal, skip)
	}

	if leaked := stripLeakedCuePrefix("李荣浩：年少有为", "年少有为", "李荣浩：If I were young", artists); leaked != "If I were young" {
		t.Fatalf("stripLeakedCuePrefix = %q", leaked)
	}
}

func TestSongAlreadyInTargetLang(t *testing.T) {
	// 纯日语（仅含 Oh yeah 简短拟声词）对 ja 判定为同语言，对 zh 需要翻译
	pureJa := []string{"Oh yeah", "君の名前を呼んでいる", "夜空に星が流れる"}
	if !songAlreadyInTargetLang(pureJa, "ja") {
		t.Fatal("pure ja with interjection should count as ja")
	}
	if songAlreadyInTargetLang(pureJa, "zh") {
		t.Fatal("pure ja should not count as zh")
	}

	// 日英混唱交由 AI 逐行判断，不应被整首跳过
	bilingualJaEn := []string{
		"君の名前を呼んでいる",
		"夜空に星が流れる",
		"Underneath the silver moonlight we are dancing all night long",
		"Hold me closer until the morning light breaks across the sky",
	}
	if songAlreadyInTargetLang(bilingualJaEn, "ja") {
		t.Fatal("bilingual ja+en should not short-circuit for ja")
	}
	if songAlreadyInTargetLang(bilingualJaEn, "en") {
		t.Fatal("bilingual ja+en should not short-circuit for en")
	}
	if songAlreadyInTargetLang(bilingualJaEn, "zh") {
		t.Fatal("bilingual ja+en should not short-circuit for zh")
	}
}

func TestParseTTMLTranslationLinesMultiLang(t *testing.T) {
	raw := `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
<head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
<translations>
  <translation xml:lang="zh-Hans"><text for="L1">第一句<span ttm:role="x-bg">（和声）</span></text></translation>
  <translation xml:lang="en-US"><text for="L1">First line<span ttm:role="x-bg">(bg)</span></text></translation>
</translations>
</iTunesMetadata></metadata></head>
<body><div>
<p begin="00:01.000" end="00:05.000" itunes:key="L1"><span begin="00:01.500" end="00:03.000"><span tts:ruby="container"><span tts:ruby="base">君</span><span tts:ruby="text">きみ</span></span>と</span><span ttm:role="x-bg"><span begin="00:01.000" end="00:01.400">ooh</span></span></p>
<p begin="00:06.000" end="00:08.000"><span ttm:role="x-bg"><span begin="00:06.000" end="00:08.000">yeah yeah</span></span></p>
</div></body></tt>`

	got := parseTTMLTranslationLines(raw)
	if len(got) != 3 {
		t.Fatalf("len = %d, got %+v", len(got), got)
	}
	// bgStarts(1000) < mainStarts(1500) 且 x-bg 在前时？在 XML 中 x-bg 在主句后，因此按 main 再 bg 排序；仅 x-bg 的段落提升为主唱 (Bg=false)
	var foundMain, foundBg, foundPromoted bool
	for _, item := range got {
		switch {
		case item.Text == "君と" && !item.Bg:
			foundMain = true
			if item.BuiltInByLang["zh"] != "第一句" || item.BuiltInByLang["en"] != "First line" {
				t.Fatalf("main translations = %+v", item.BuiltInByLang)
			}
		case item.Text == "ooh" && item.Bg:
			foundBg = true
			if item.BuiltInByLang["zh"] != "（和声）" || item.BuiltInByLang["en"] != "(bg)" {
				t.Fatalf("bg translations = %+v", item.BuiltInByLang)
			}
		case item.Text == "yeah yeah" && !item.Bg:
			foundPromoted = true
		}
	}
	if !foundMain || !foundBg || !foundPromoted {
		t.Fatalf("missing line: main=%v bg=%v promoted=%v (%+v)", foundMain, foundBg, foundPromoted, got)
	}
}

func TestGetLyricTranslationsNativeAndRetranslateZhTW(t *testing.T) {
	track := dto.MusicTrackDto{ID: 101, Name: "Test Song", Artists: []string{"Alice"}}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})

	ncmEn := "[00:05.00]I walk alone tonight\n[00:10.00]Under the neon lights\n"
	ncmZh := "[00:05.00]今晚我独自走着\n[00:10.00]在霓虹灯光之下\n"
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data: &dto.MusicLyricDto{
				Lrc:    lyricPart(ncmEn),
				Tlyric: lyricPart(ncmZh),
			},
			outcome: lyricOutcomeHit,
		},
	})

	var gotSystem, gotUser string
	calls, wait := stubLyricTranslationService(t, func(system, user string) (string, error) {
		gotSystem, gotUser = system, user
		return `{"lines":[{"i":1,"t":"今夜我獨自漫步"},{"i":2,"t":"在霓虹燈影之下"}]}`, nil
	})

	s := NewMusicService()
	ctx := context.Background()

	// 英文歌已有简体中文翻译 -> zh 访问直接命中原生，不调用 AI
	zhRes, svcerr := s.GetLyricTranslations(ctx, 101, "ncm-lrc", "zh")
	if svcerr != nil || zhRes.Status != "ready" || !zhRes.Native || calls.Load() != 0 {
		t.Fatalf("zh native = %+v, err=%v, calls=%d", zhRes, svcerr, calls.Load())
	}

	// 同首歌用 zh-tw 访问 -> 识别为简体而非繁中，触发 AI 地道繁中重译，且带原文(en)与参考译文(zh)
	twRes, svcerr := s.GetLyricTranslations(ctx, 101, "ncm-lrc", "zh-tw")
	if svcerr != nil || twRes.Status != "pending" {
		t.Fatalf("zh-tw first = %+v, err=%v", twRes, svcerr)
	}
	wait()

	if !strings.Contains(gotSystem, "繁體中文") || !strings.Contains(gotUser, `"orig_lang":"en"`) || !strings.Contains(gotUser, `"ref_lang":"zh"`) || !strings.Contains(gotUser, `"ref":"今晚我独自走着"`) {
		t.Fatalf("unexpected prompt:\nsystem=%s\nuser=%s", gotSystem, gotUser)
	}

	twReady, svcerr := s.GetLyricTranslations(ctx, 101, "ncm-lrc", "zh-tw")
	if svcerr != nil || twReady.Status != "ready" || twReady.Native || len(twReady.Lines) != 2 || twReady.Lines[0].Translation != "今夜我獨自漫步" {
		t.Fatalf("zh-tw ready = %+v, err=%v", twReady, svcerr)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 LLM call, got %d", calls.Load())
	}
}

func TestGetLyricTranslationsMultiSourceAndBorrowedRefAndCues(t *testing.T) {
	track := dto.MusicTrackDto{ID: 202, Name: "Bilingual", Artists: []string{"李荣浩"}}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})

	ttml := `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<body><div>
<p begin="00:01.000" end="00:02.000"><span begin="00:01.000" end="00:02.000">李荣浩：</span></p>
<p begin="00:03.000" end="00:06.000"><span begin="00:03.000" end="00:06.000">李荣浩：君の名前を呼ぶ</span></p>
<p begin="00:07.000" end="00:10.000"><span begin="00:07.000" end="00:10.000">Hold my hand tonight</span></p>
<p begin="00:11.000" end="00:14.000"><span begin="00:11.000" end="00:14.000">君の名前を呼ぶ</span></p>
</div></body></tt>`

	ncmOrig := "[00:03.00]君の名前を呼ぶ\n[00:07.00]Hold my hand tonight\n"
	ncmZh := "[00:03.00]呼唤你的名字\n[00:07.00]今晚握紧我的手\n"
	ncm := &dto.MusicLyricDto{
		Lrc:    lyricPart(ncmOrig),
		Tlyric: lyricPart(ncmZh),
	}

	stubLyricSources(t, map[string]lyricSourceResult{
		"ttml": {data: &dto.MusicTTMLDto{Source: musicTTMLSourceAMLL, TTML: ttml}, outcome: lyricOutcomeHit},
		"ncm":  {data: ncm, outcome: lyricOutcomeHit},
	})

	var gotUser atomic.Value
	calls, wait := stubLyricTranslationService(t, func(_, user string) (string, error) {
		gotUser.Store(user)
		// 只给日语行返回英文译文；Hold my hand tonight 返回空字符串保留不译
		return `{"lines":[{"i":1,"t":"李荣浩：Calling your name"},{"i":2,"t":""},{"i":3,"t":"Calling your name"}]}`, nil
	})

	s := NewMusicService()
	ctx := context.Background()

	// 非白名单歌曲公开请求返回 404
	if _, svcerr := s.GetLyricTranslations(ctx, 9999, "ttml-amll", "en"); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("non-whitelisted song = %v", svcerr)
	}

	// TTML-AMLL 自身无翻译 -> 从 NCM 借用中文作参考译文并送去翻成 en
	res, svcerr := s.GetLyricTranslations(ctx, 202, "ttml-amll", "en")
	if svcerr != nil || res.Status != "pending" {
		t.Fatalf("ttml pending = %+v, err=%v", res, svcerr)
	}
	wait()

	prompt := gotUser.Load().(string)
	if strings.Contains(prompt, "李荣浩：") {
		t.Fatalf("prompt should strip singer prefix and skip cue line: %s", prompt)
	}
	if !strings.Contains(prompt, `"ref":"呼唤你的名字"`) {
		t.Fatalf("prompt should include borrowed ref translation: %s", prompt)
	}

	ready, svcerr := s.GetLyricTranslations(ctx, 202, "ttml-amll", "en")
	if svcerr != nil || ready.Status != "ready" {
		t.Fatalf("ttml ready = %+v, err=%v", ready, svcerr)
	}
	// 行 1 ("李荣浩：") 跳过，行 2 返回带回漏出前缀的译文被剥离且保留 origText，行 3 返回空被略过，行 4 为第 0 次出现
	wantLines := []dto.MusicLyricTranslationLine{
		{Text: "李荣浩：君の名前を呼ぶ", Occurrence: 0, Translation: "Calling your name"},
		{Text: "君の名前を呼ぶ", Occurrence: 0, Translation: "Calling your name"},
	}
	if !reflect.DeepEqual(ready.Lines, wantLines) {
		t.Fatalf("lines = %+v\nwant %+v", ready.Lines, wantLines)
	}

	// 同首歌的 ncm-lrc 是独立词源，尚未翻译到 en，应触发单独任务
	ncmRes, svcerr := s.GetLyricTranslations(ctx, 202, "ncm-lrc", "en")
	if svcerr != nil || ncmRes.Status != "pending" {
		t.Fatalf("ncm-lrc should be cached separately from ttml-amll: %+v, err=%v", ncmRes, svcerr)
	}
	wait()
	if calls.Load() != 2 {
		t.Fatalf("expected 2 separate LLM calls, got %d", calls.Load())
	}
}

func TestRefreshLyricTranslationsBypassCooldownAndOverwrite(t *testing.T) {
	track := dto.MusicTrackDto{ID: 303, Name: "Moon", Artists: []string{"Bob"}}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data:    &dto.MusicLyricDto{Lrc: lyricPart("[00:01.00]Moonlight shines\n[00:05.00]Shadows fade away\n")},
			outcome: lyricOutcomeHit,
		},
	})

	var fail atomic.Bool
	fail.Store(true)
	calls, wait := stubLyricTranslationService(t, func(_, _ string) (string, error) {
		if fail.Load() {
			return "", errors.New("upstream timeout")
		}
		return `{"lines":[{"i":1,"t":"月光照耀"},{"i":2,"t":"影が消える"}]}`, nil
	})

	s := NewMusicService()
	ctx := context.Background()

	// 首次失败后进入冷却期，再访问返回 404 不重试
	if _, svcerr := s.GetLyricTranslations(ctx, 303, "ncm-lrc", "zh"); svcerr != nil {
		t.Fatalf("first get = %v", svcerr)
	}
	wait()
	if _, svcerr := s.GetLyricTranslations(ctx, 303, "ncm-lrc", "zh"); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("cooldown get = %v", svcerr)
	}

	// 管理员刷新绕过冷却期并覆盖写入结果
	fail.Store(false)
	admin := &model.User{Username: "admin", Email: "a@example.com", Password: "x", Role: "admin"}
	if err := repo.GetDB().Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	adminCtx := context.WithValue(context.Background(), "user_id", admin.ID)
	refreshed, svcerr := s.RefreshLyricTranslations(adminCtx, 303, "ncm-lrc", "zh")
	if svcerr != nil || refreshed.Status != "pending" {
		t.Fatalf("refresh = %+v, err=%v", refreshed, svcerr)
	}
	wait()

	ready, svcerr := s.GetLyricTranslations(ctx, 303, "ncm-lrc", "zh")
	if svcerr != nil || ready.Status != "ready" || len(ready.Lines) != 2 || ready.Lines[0].Translation != "月光照耀" {
		t.Fatalf("after refresh = %+v, err=%v", ready, svcerr)
	}
	if calls.Load() < 3 {
		t.Fatalf("expected retries + refresh calls, got %d", calls.Load())
	}

	// 纯中文歌访问 zh 直接返回 SameLanguage=true，不调 LLM
	beforeCalls := calls.Load()
	zhSongTrack := dto.MusicTrackDto{ID: 304, Name: "晴天", Artists: []string{"周杰伦"}}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{zhSongTrack})
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data:    &dto.MusicLyricDto{Lrc: lyricPart("[00:01.00]故事的小黄花\n[00:05.00]从出生那年就飘着\n")},
			outcome: lyricOutcomeHit,
		},
	})
	sameRes, svcerr := s.GetLyricTranslations(ctx, 304, "ncm-lrc", "zh")
	if svcerr != nil || sameRes.Status != "ready" || !sameRes.SameLanguage || calls.Load() != beforeCalls {
		t.Fatalf("same lang = %+v, err=%v", sameRes, svcerr)
	}

	// 验证序列化格式与预期字段
	raw, _ := json.Marshal(ready)
	if !strings.Contains(string(raw), `"target_lang":"zh"`) {
		t.Fatalf("unexpected dto json: %s", raw)
	}
}

func TestLyricTranslationZHHKAndMixedScatDetection(t *testing.T) {
	// zh-HK / zh-MO / zh-Hant-HK 与 zh-TW 分开规范化
	if got := normalizeLyricLangTag("zh-HK"); got != "zh-hk" {
		t.Fatalf("zh-HK = %q", got)
	}
	if got := normalizeLyricLangTag("zh-MO"); got != "zh-hk" {
		t.Fatalf("zh-MO = %q", got)
	}
	if got := normalizeLyricLangTag("zh-Hant-HK"); got != "zh-hk" {
		t.Fatalf("zh-Hant-HK = %q", got)
	}
	if got := normalizeLyricLangTag("zh-Hant"); got != "zh-tw" {
		t.Fatalf("zh-Hant = %q", got)
	}

	// 纯中文 + 纯英文拟声词/哼唱（如 Pico bala-ba-ba-ba）判定为已属中文，不触发 AI
	pureChineseWithScat := []string{
		"Pico bala-ba-ba-ba",
		"Bibo bala-ba-ba-ba",
		"Dido bala-ba-ba-ba",
		"Nino na-ra-na-na-na",
		"叮咚 叮叮咚咚",
		"收到总部命令",
	}
	if !songAlreadyInTargetLang(pureChineseWithScat, "zh") {
		t.Fatal("pure Chinese + scat song should be treated as already in target language")
	}

	// 混有日语 semantic 句 + 行内拟声词 -> 需要 AI 逐行判断是否翻译/保留
	mixedWithJapanese := []string{
		"人は猫dala-da-da-da",
		"Pico bala-ba-ba-ba",
		"絶対にそう ny-ny-nya-nya-nya",
		"叮咚 叮叮咚咚",
		"收到总部命令",
	}
	if songAlreadyInTargetLang(mixedWithJapanese, "zh") {
		t.Fatal("Chinese song mixing Japanese semantic lines should trigger AI translation")
	}

	// 单行实质性英文句亦应触发 AI，且虚词英文句不误判为拟声词
	if songAlreadyInTargetLang([]string{"今晚的夜色真温柔", "Tell me why you never say goodbye"}, "zh") {
		t.Fatal("Chinese song with 1 substantive English line should trigger AI translation")
	}
	for _, englishLine := range []string{"No I love you", "In my heart", "To you"} {
		if isShortInterjectionLatin(englishLine) {
			t.Fatalf("%q should not be treated as pure scat/interjection", englishLine)
		}
	}

	// zh-hk 与 zh-tw 各自独立缓存并发送对应地区繁体提示词
	track := dto.MusicTrackDto{ID: 405, Name: "Harbour", Artists: []string{"Chan"}}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data: &dto.MusicLyricDto{
				Lrc:    lyricPart("[00:01.00]I take a taxi home\n[00:05.00]Night falls softly\n"),
				Tlyric: lyricPart("[00:01.00]我搭出租车回家\n[00:05.00]夜色温柔降临\n"),
			},
			outcome: lyricOutcomeHit,
		},
	})

	var prompts []string
	calls, wait := stubLyricTranslationService(t, func(system, _ string) (string, error) {
		prompts = append(prompts, system)
		if strings.Contains(system, "zh-hk") {
			return `{"lines":[{"i":1,"t":"我搭的士歸家"},{"i":2,"t":"夜幕輕柔降臨"}]}`, nil
		}
		return `{"lines":[{"i":1,"t":"我搭計程車回家"},{"i":2,"t":"夜幕輕柔降臨"}]}`, nil
	})

	s := NewMusicService()
	ctx := context.Background()

	if res, svcerr := s.GetLyricTranslations(ctx, 405, "ncm-lrc", "zh-hk"); svcerr != nil || res.Status != "pending" {
		t.Fatalf("zh-hk pending = %+v, err=%v", res, svcerr)
	}
	wait()
	hkReady, svcerr := s.GetLyricTranslations(ctx, 405, "ncm-lrc", "zh-hk")
	if svcerr != nil || hkReady.Status != "ready" || hkReady.Lines[0].Translation != "我搭的士歸家" {
		t.Fatalf("zh-hk ready = %+v, err=%v", hkReady, svcerr)
	}

	if res, svcerr := s.GetLyricTranslations(ctx, 405, "ncm-lrc", "zh-tw"); svcerr != nil || res.Status != "pending" {
		t.Fatalf("zh-tw pending = %+v, err=%v", res, svcerr)
	}
	wait()
	twReady, svcerr := s.GetLyricTranslations(ctx, 405, "ncm-lrc", "zh-tw")
	if svcerr != nil || twReady.Status != "ready" || twReady.Lines[0].Translation != "我搭計程車回家" {
		t.Fatalf("zh-tw ready = %+v, err=%v", twReady, svcerr)
	}
	if calls.Load() != 2 || !strings.Contains(prompts[0], "香港澳門繁體書面語") || !strings.Contains(prompts[1], "台灣繁體中文") {
		t.Fatalf("unexpected calls=%d prompts=%q", calls.Load(), prompts)
	}
}

func TestLyricTranslationParallelFirstScreenPartialAndStaleRefresh(t *testing.T) {
	track := dto.MusicTrackDto{ID: 406, Name: "Long Ballad", Artists: []string{"Singer"}}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})

	var lrcBuilder strings.Builder
	for i := 1; i <= 35; i++ {
		min := i / 60
		sec := i % 60
		fmt.Fprintf(&lrcBuilder, "[%02d:%02d.00]English lyric line number %d\n", min, sec, i)
	}
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data:    &dto.MusicLyricDto{Lrc: lyricPart(lrcBuilder.String())},
			outcome: lyricOutcomeHit,
		},
	})

	// 验证首屏 24 行切段规则
	chunks := lyricTranslationChunks(35)
	if len(chunks) != 2 || chunks[0] != [2]int{0, 24} || chunks[1] != [2]int{24, 35} {
		t.Fatalf("unexpected chunks for 35 lines: %+v", chunks)
	}

	orig := lyricTranslations
	origRetry := lyricTranslationRetryDelay
	lyricTranslationRetryDelay = 0
	doneCh := make(chan struct{}, 8)
	releaseChunk1 := make(chan struct{})
	var blockRefresh atomic.Bool
	releaseRefresh := make(chan struct{})
	refreshStarted := make(chan struct{}, 4)

	buildResp := func(from, to int, prefix string) string {
		var items []map[string]any
		for i := from; i <= to; i++ {
			items = append(items, map[string]any{"i": i, "t": fmt.Sprintf("%s%d", prefix, i)})
		}
		raw, _ := json.Marshal(map[string]any{"lines": items})
		return string(raw)
	}

	svc := &lyricTranslationService{
		name:        "test_tr_partial_" + t.Name(),
		limiter:     &llmclient.Limiter{},
		concurrency: func() int { return 3 },
		complete: func(_ context.Context, _ tools.AIConfig, _, user string) (string, error) {
			if blockRefresh.Load() {
				select {
				case refreshStarted <- struct{}{}:
				default:
				}
				<-releaseRefresh
			}
			if strings.Contains(user, `"i":1,`) {
				if !strings.Contains(user, `"context_after"`) {
					t.Errorf("first-screen chunk prompt missing context_after: %s", user)
				}
				return buildResp(1, 24, "首屏译文"), nil
			}
			if !strings.Contains(user, `"context_before"`) {
				t.Errorf("background chunk prompt missing context_before: %s", user)
			}
			<-releaseChunk1
			return buildResp(25, 35, "后续译文"), nil
		},
		done: func() { doneCh <- struct{}{} },
	}
	lyricTranslations = svc
	t.Cleanup(func() {
		lyricTranslations = orig
		lyricTranslationRetryDelay = origRetry
	})

	s := NewMusicService()
	ctx := context.Background()

	first, svcerr := s.GetLyricTranslations(ctx, 406, "ncm-lrc", "zh")
	if svcerr != nil || first.Status != "pending" {
		t.Fatalf("first get = %+v, err=%v", first, svcerr)
	}

	// chunk 1 尚未完成前，轮询应先拿到 chunk 0 的 24 行 partial 译文
	var partial *dto.MusicLyricTranslationsDto
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		cur, err := s.GetLyricTranslations(ctx, 406, "ncm-lrc", "zh")
		if err == nil && cur.Status == "pending" && len(cur.Lines) == 24 {
			partial = cur
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if partial == nil || partial.Lines[0].Translation != "首屏译文1" {
		close(releaseChunk1)
		t.Fatalf("expected 24 Stage-1 partial translation lines while chunk 1 blocked, got %+v", partial)
	}

	close(releaseChunk1)
	<-doneCh

	ready, svcerr := s.GetLyricTranslations(ctx, 406, "ncm-lrc", "zh")
	if svcerr != nil || ready.Status != "ready" || ready.Stale || len(ready.Lines) != 35 || ready.Lines[34].Translation != "后续译文35" {
		t.Fatalf("ready = %+v, err=%v", ready, svcerr)
	}

	// 已有缓存时管理员刷新：返回 ready + stale=true，且轮询期间保持 stale=true 直到新结果落库
	admin := &model.User{Username: "admin_tr", Email: "atr@example.com", Password: "x", Role: "admin"}
	if err := repo.GetDB().Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	adminCtx := context.WithValue(context.Background(), "user_id", admin.ID)
	blockRefresh.Store(true)
	refreshed, svcerr := s.RefreshLyricTranslations(adminCtx, 406, "ncm-lrc", "zh")
	if svcerr != nil || refreshed.Status != "ready" || !refreshed.Stale || len(refreshed.Lines) != 35 {
		close(releaseRefresh)
		t.Fatalf("refresh with cache = %+v, err=%v", refreshed, svcerr)
	}
	<-refreshStarted
	polling, svcerr := s.GetLyricTranslations(ctx, 406, "ncm-lrc", "zh")
	if svcerr != nil || polling.Status != "ready" || !polling.Stale {
		close(releaseRefresh)
		t.Fatalf("polling during refresh should set Stale=true, got %+v, err=%v", polling, svcerr)
	}
	close(releaseRefresh)
	<-doneCh
	settled, svcerr := s.GetLyricTranslations(ctx, 406, "ncm-lrc", "zh")
	if svcerr != nil || settled.Status != "ready" || settled.Stale {
		t.Fatalf("after refresh completed, Stale should be false: %+v, err=%v", settled, svcerr)
	}
}

func TestDetectLangScriptCrossCheckAndWrongScriptRetry(t *testing.T) {
	// 显式标注错位时以实际文字脚本交叉校验为准
	if got := detectLyricTextLang([]string{"今晚的夜色真温柔", "我想牵着你的手散步"}, "ja"); got != "zh" {
		t.Fatalf("chinese lyrics mistagged as ja = %q, want zh", got)
	}
	if got := detectLyricTextLang([]string{"今夜の風がとても優しい", "君の手を繋いで歩きたい"}, "zh"); got != "ja" {
		t.Fatalf("japanese lyrics mistagged as zh = %q, want ja", got)
	}

	track := dto.MusicTrackDto{ID: 501, Name: "温柔夜色", Artists: []string{"陈奕迅"}}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
	stubLyricSources(t, map[string]lyricSourceResult{
		"ncm": {
			data: &dto.MusicLyricDto{
				Lrc: lyricPart("[00:01.00]今晚的夜色真的好温柔\n[00:05.00]我想牵着你的手一起走\n"),
			},
			outcome: lyricOutcomeHit,
		},
	})

	calls, wait := stubLyricTranslationService(t, func(_, user string) (string, error) {
		if !strings.Contains(user, "CRITICAL RETRY NOTICE") {
			// 第 1 次故意误返回全中文，应触发脚本校验失败并重试
			return `{"lines":[{"i":1,"t":"今晚的夜色真的好温柔"},{"i":2,"t":"我想牵着你的手一起走"}]}`, nil
		}
		return `{"lines":[{"i":1,"t":"今夜の夜空は本当に優しい"},{"i":2,"t":"君の手を繋いで一緒に歩きたい"}]}`, nil
	})

	s := NewMusicService()
	ctx := context.Background()
	res, svcerr := s.GetLyricTranslations(ctx, 501, "ncm-lrc", "ja")
	if svcerr != nil || res.Status != "pending" {
		t.Fatalf("first get = %+v, err=%v", res, svcerr)
	}
	wait()

	ready, svcerr := s.GetLyricTranslations(ctx, 501, "ncm-lrc", "ja")
	if svcerr != nil || ready.Status != "ready" || len(ready.Lines) != 2 {
		t.Fatalf("ready = %+v, err=%v", ready, svcerr)
	}
	if ready.Lines[0].Translation != "今夜の夜空は本当に優しい" {
		t.Fatalf("retried ja translation = %q", ready.Lines[0].Translation)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected retry after wrong script output (calls=2), got %d", calls.Load())
	}
}

func TestClassicalChineseAndHintCreditLines(t *testing.T) {
	pipaxing := []string{
		"浔阳江头夜送客",
		"枫叶荻花秋瑟瑟",
		"主人下马客在船",
		"举酒欲饮无管弦",
		"醉不成欢惨将别",
		"别时茫茫江浸月",
		"忽闻水上琵琶声",
		"主人忘归客不发",
	}
	if !songHasClassicalChinese(pipaxing) || songAlreadyInTargetLang(pipaxing, "zh") {
		t.Fatal("full classical poem should trigger vernacular translation under zh")
	}

	gufeng := []string{
		"恰似故人踏月归来",
		"与君共饮此杯中酒",
		"我们一起笑着奔向明天",
		"阳光洒在肩上",
	}
	if !songHasClassicalChinese(gufeng) || songAlreadyInTargetLang(gufeng, "zh") {
		t.Fatal("semi-classical gufeng lyrics should trigger classical mode")
	}

	modern := []string{
		"我好想你",
		"你在我身边",
		"阳光洒在肩上",
		"风吹过窗台",
	}
	if songHasClassicalChinese(modern) || !songAlreadyInTargetLang(modern, "zh") {
		t.Fatal("plain modern Chinese lyrics should stay in target lang")
	}

	// 验证古典诗词歌曲走 zh 白话翻译 + Hint 署名行保留冒号前缀且进入翻译输入
	track := dto.MusicTrackDto{ID: 502, Name: "琵琶行", Artists: []string{"奇然"}}
	setupMusicTranslationEnv(t, []dto.MusicTrackDto{track})
	stubLyricSources(t, map[string]lyricSourceResult{
		"ttml": {
			data: &dto.MusicTTMLDto{
				TTML: "<tt xmlns=\"http://www.w3.org/ns/ttml\"><body><div><p begin=\"00:01.000\" end=\"00:03.000\">作词：白居易</p><p begin=\"00:04.000\" end=\"00:07.000\">浔阳江头夜送客</p><p begin=\"00:08.000\" end=\"00:11.000\">枫叶荻花秋瑟瑟</p><p begin=\"00:12.000\" end=\"00:15.000\">主人下马客在船</p><p begin=\"00:16.000\" end=\"00:19.000\">忽闻水上琵琶声</p></div></body></tt>",
			},
			outcome: lyricOutcomeHit,
		},
	})

	var gotUser atomic.Value
	calls, wait := stubLyricTranslationService(t, func(_, user string) (string, error) {
		gotUser.Store(user)
		return `{"lines":[{"i":1,"t":"原作：白居易（唐）"},{"i":2,"t":"深夜在浔阳江边送别友人"},{"i":3,"t":"秋风吹过枫叶与芦荻沙沙作响"},{"i":4,"t":"主人下马与客人同上小船"},{"i":5,"t":"忽然听见江面上传来琵琶声"}]}`, nil
	})

	s := NewMusicService()
	ctx := context.Background()
	res, svcerr := s.GetLyricTranslations(ctx, 502, "ttml-amll", "zh")
	if svcerr != nil || res.Status != "pending" {
		t.Fatalf("first get = %+v, err=%v", res, svcerr)
	}
	wait()

	prompt := gotUser.Load().(string)
	if !strings.Contains(prompt, "作词：白居易") {
		t.Fatalf("hint credit line should be passed to LLM prompt: %s", prompt)
	}
	if !strings.Contains(prompt, `"hint":true`) {
		t.Fatalf("hint credit line should carry hint flag: %s", prompt)
	}
	if !strings.Contains(prompt, `"classical_mode":true`) {
		t.Fatalf("classical mode flag missing in prompt: %s", prompt)
	}
	ready, svcerr := s.GetLyricTranslations(ctx, 502, "ttml-amll", "zh")
	if svcerr != nil || ready.Status != "ready" || ready.SameLanguage || calls.Load() != 1 {
		t.Fatalf("ready = %+v, err=%v, calls=%d", ready, svcerr, calls.Load())
	}
	if len(ready.Lines) != 5 || ready.Lines[0].Translation != "原作：白居易（唐）" {
		t.Fatalf("hint translation should keep colon attribution intact: %+v", ready.Lines)
	}
}
