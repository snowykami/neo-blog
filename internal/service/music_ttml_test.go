package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

const testTTML = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:01.000" end="00:02.000"><span begin="00:01.000" end="00:02.000">hi</span></p></div></body></tt>`

// ttmlServer 按路径返回固定的状态与正文，并统计请求次数
func ttmlServer(t *testing.T, status int, body string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if status >= 300 && status < 400 {
			http.Redirect(w, r, "/elsewhere", status)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

// setupTTMLDB 自定义源的地址在环境变量没有设置时读后台配置，测试用临时数据库
func setupTTMLDB(t *testing.T) {
	t.Helper()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
}

func setupTTMLTest(t *testing.T, customPrefix string, mirrors ...string) {
	t.Helper()
	setupTTMLDB(t)
	resetLyricSharedState(t)
	t.Setenv("MUSIC_TTML_URL_PREFIX", customPrefix)
	original := musicTTMLMirrors
	musicTTMLMirrors = mirrors
	musicTTMLCache.Clear()
	t.Cleanup(func() {
		musicTTMLMirrors = original
		musicTTMLCache.Clear()
	})
}

func TestTTMLLyricPriority(t *testing.T) {
	custom, _ := ttmlServer(t, http.StatusOK, strings.Replace(testTTML, "hi", "custom", 1))
	amll, _ := ttmlServer(t, http.StatusOK, testTTML)
	setupTTMLTest(t, custom.URL+"/", amll.URL)
	s := NewMusicService()

	// 自定义源优先
	got, svcerr := s.GetTTMLLyric(context.Background(), 1, "")
	if svcerr != nil || got.Source != musicTTMLSourceCustom || !strings.Contains(got.TTML, "custom") {
		t.Fatalf("auto = %+v, %v", got, svcerr)
	}
	// 手动切换：只取 AMLL
	got, svcerr = s.GetTTMLLyric(context.Background(), 1, musicTTMLSourceAMLL)
	if svcerr != nil || got.Source != musicTTMLSourceAMLL {
		t.Fatalf("amll = %+v, %v", got, svcerr)
	}
	if _, svcerr = s.GetTTMLLyric(context.Background(), 1, "qq"); svcerr == nil || svcerr.Code != http.StatusBadRequest {
		t.Fatalf("unknown source should be rejected, got %v", svcerr)
	}
}

func TestTTMLLyricCustomSourcesOrder(t *testing.T) {
	missing, missingCalls := ttmlServer(t, http.StatusNotFound, "")
	second, _ := ttmlServer(t, http.StatusOK, strings.Replace(testTTML, "hi", "second", 1))
	third, _ := ttmlServer(t, http.StatusOK, strings.Replace(testTTML, "hi", "third", 1))
	amll, _ := ttmlServer(t, http.StatusOK, testTTML)
	setupTTMLTest(t, "", amll.URL)
	sources := []any{
		map[string]any{"name": "liteyuki源", "url": missing.URL + "/{id}.ttml"},
		map[string]any{"name": "snowykami源", "url": second.URL + "/{song_id}.ttml"},
		map[string]any{"name": "", "url": third.URL},
	}
	if err := repo.KV.SetKV("music_ttml_sources", sources); err != nil {
		t.Fatal(err)
	}

	// 按列表顺序：前面的源确定没有时用下一个命中的，并带上它的名称
	got, svcerr := NewMusicService().GetTTMLLyric(context.Background(), 8, "")
	if svcerr != nil || got.Source != musicTTMLSourceCustom || got.Name != "snowykami源" || !strings.Contains(got.TTML, "second") {
		t.Fatalf("got %+v, %v", got, svcerr)
	}
	if missingCalls.Load() != 1 {
		t.Fatalf("first source should be probed once, calls = %d", missingCalls.Load())
	}
}

func TestTTMLSourcesConfig(t *testing.T) {
	setupTTMLDB(t)
	t.Setenv("MUSIC_TTML_URL_PREFIX", "")
	urls := func() []string {
		var got []string
		for _, target := range ttmlTargets(7, []string{musicTTMLSourceCustom, musicTTMLSourceAMLL}) {
			got = append(got, target.name+"|"+target.url)
		}
		return got
	}
	if got := urls(); !reflect.DeepEqual(got, []string{"|"}) {
		t.Fatalf("no custom source: got %q", got)
	}
	if err := repo.KV.SetKV("music_ttml_sources", []any{map[string]any{"name": "后台", "url": "https://console.example.com/{song_id}.ttml"}}); err != nil {
		t.Fatal(err)
	}
	// 环境变量没有设置时用后台配置
	if got := urls(); !reflect.DeepEqual(got, []string{"后台|https://console.example.com/7.ttml", "|"}) {
		t.Fatalf("console config: got %q", got)
	}
	// 两者都有时环境变量优先（旧的单个地址视为一个没有名称的源），并报告给后台显示为只读
	t.Setenv("MUSIC_TTML_URL_PREFIX", "https://env.example.com/{id}.ttml")
	if got := urls(); !reflect.DeepEqual(got, []string{"|https://env.example.com/7.ttml", "|"}) {
		t.Fatalf("env first: got %q", got)
	}
	if env, _ := config.Lookup("music_ttml_sources").EnvValue(); env != "https://env.example.com/{id}.ttml" {
		t.Fatalf("env value = %q", env)
	}
	// 环境变量也可以是 JSON 数组
	t.Setenv("MUSIC_TTML_URL_PREFIX", `[{"name":"甲","url":"https://a.example.com/lyrics/"},{"name":"乙","url":"https://b.example.com/{id}"}]`)
	if got := urls(); !reflect.DeepEqual(got, []string{"甲|https://a.example.com/lyrics/7.ttml", "乙|https://b.example.com/7", "|"}) {
		t.Fatalf("env list: got %q", got)
	}
}

func TestTTMLLyricCustomTemplate(t *testing.T) {
	var requested string
	custom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = r.URL.RequestURI()
		_, _ = w.Write([]byte(testTTML))
	}))
	t.Cleanup(custom.Close)
	amll, _ := ttmlServer(t, http.StatusNotFound, "")
	setupTTMLTest(t, custom.URL+"/music/lyrics/{id}.ttml", amll.URL)

	got, svcerr := NewMusicService().GetTTMLLyric(context.Background(), 7, "")
	if svcerr != nil || got.Source != musicTTMLSourceCustom || requested != "/music/lyrics/7.ttml" {
		t.Fatalf("got %+v, %v, requested %q", got, svcerr, requested)
	}
}

func TestTTMLLyricMirrors(t *testing.T) {
	custom, _ := ttmlServer(t, http.StatusNotFound, "")
	failing, _ := ttmlServer(t, http.StatusInternalServerError, "")
	missing, _ := ttmlServer(t, http.StatusNotFound, "")
	hit, _ := ttmlServer(t, http.StatusOK, testTTML)
	setupTTMLTest(t, custom.URL, failing.URL, missing.URL, hit.URL)

	// 自定义源没有、部分镜像出错或没有：仍取到命中的镜像
	got, svcerr := NewMusicService().GetTTMLLyric(context.Background(), 2, "")
	if svcerr != nil || got.Source != musicTTMLSourceAMLL {
		t.Fatalf("got %+v, %v", got, svcerr)
	}
}

func TestTTMLLyricMissCache(t *testing.T) {
	redirect, redirectCalls := ttmlServer(t, http.StatusFound, "")
	html, htmlCalls := ttmlServer(t, http.StatusOK, "<!doctype html><html></html>")
	setupTTMLTest(t, "", redirect.URL, html.URL)
	s := NewMusicService()

	// 重定向与非 TTML 正文都是确定未命中：返回 404，并在负缓存有效期内不再请求
	for range 2 {
		if _, svcerr := s.GetTTMLLyric(context.Background(), 3, ""); svcerr == nil || svcerr.Code != http.StatusNotFound {
			t.Fatalf("expected not found, got %v", svcerr)
		}
	}
	if redirectCalls.Load() != 1 || htmlCalls.Load() != 1 {
		t.Fatalf("definite misses should be cached, calls = %d, %d", redirectCalls.Load(), htmlCalls.Load())
	}
}

func TestTTMLLyricMissQuorum(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(3 * time.Second):
		}
		http.Redirect(w, r, "/elsewhere", http.StatusFound)
	}))
	t.Cleanup(slow.Close)
	first, _ := ttmlServer(t, http.StatusNotFound, "")
	second, _ := ttmlServer(t, http.StatusNotFound, "")
	setupTTMLTest(t, "", slow.URL, first.URL, second.URL)

	// 两个镜像确定未命中即断定没有，不等很慢才返回的镜像
	start := time.Now()
	if _, svcerr := NewMusicService().GetTTMLLyric(context.Background(), 5, ""); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("expected not found, got %v", svcerr)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("should not wait for the slow mirror, took %v", elapsed)
	}
}

func TestTTMLLyricErrorsNotCached(t *testing.T) {
	failing, calls := ttmlServer(t, http.StatusBadGateway, "")
	missing, _ := ttmlServer(t, http.StatusNotFound, "")
	setupTTMLTest(t, "", failing.URL, missing.URL)
	s := NewMusicService()

	// 有镜像出错时不能断定没有：不缓存，下次重新请求
	for range 2 {
		if _, svcerr := s.GetTTMLLyric(context.Background(), 4, ""); svcerr == nil {
			t.Fatal("expected not found")
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("errors must not be cached, calls = %d", calls.Load())
	}
}

func TestIsTTMLDocument(t *testing.T) {
	cases := map[string]bool{
		testTTML:                           true,
		"\xef\xbb\xbf  " + testTTML:        true,
		"<html><body>404</body></html>":    false,
		"<tt><p>unclosed</tt>":             false,
		"not xml":                          false,
		`{"code":200}`:                     false,
		"<?xml version=\"1.0\"?><tt></tt>": true,
	}
	for input, want := range cases {
		if got := isTTMLDocument([]byte(input)); got != want {
			t.Errorf("isTTMLDocument(%q) = %v, want %v", input, got, want)
		}
	}
}

// seedTTMLHit 直接写入一条命中缓存，模拟之前取到的 TTML（checkedAgo 为上次与上游核对距现在的时间）
func seedTTMLHit(id int64, ttml string, checkedAgo time.Duration) {
	entry := musicTTMLCacheEntry{TTML: ttml, Hash: lyricContentDigest(ttml), CheckedAt: time.Now().Add(-checkedAgo).Unix()}
	data, _ := json.Marshal(entry)
	musicTTMLCache.Put(ttmlCacheKey(musicTTMLSourceAMLL, id), data, musicTTMLHitTTL)
}

func TestTTMLLyricRevalidatesAfterInterval(t *testing.T) {
	// 上游只改了某个字的时间轴：歌词文本没变，正文摘要变了
	updated := strings.Replace(testTTML, `begin="00:01.000" end="00:02.000"`, `begin="00:01.400" end="00:02.400"`, 1)
	server, calls := ttmlServer(t, http.StatusOK, updated)
	setupTTMLTest(t, "", server.URL)
	seedTTMLHit(11, testTTML, 2*lyricRevalidateInterval)
	s := NewMusicService()

	// 超过复核间隔：先返回缓存（不等上游），后台复核发现摘要不同后更新缓存
	got, svcerr := s.GetTTMLLyric(context.Background(), 11, musicTTMLSourceAMLL)
	if svcerr != nil || got.TTML != testTTML {
		t.Fatalf("got %+v, %v, want stale ttml immediately", got, svcerr)
	}
	waitLyricCondition(t, "ttml background revalidation", func() bool {
		entry := loadTTMLCacheEntry(musicTTMLCache, ttmlCacheKey(musicTTMLSourceAMLL, 11))
		return entry.ok && entry.entry.TTML == updated
	})
	if calls.Load() != 1 {
		t.Fatalf("should revalidate once, calls = %d", calls.Load())
	}
	// 刚核对过：再取用缓存，不再请求
	if got, svcerr = s.GetTTMLLyric(context.Background(), 11, musicTTMLSourceAMLL); svcerr != nil || got.TTML != updated {
		t.Fatalf("cached = %+v, %v", got, svcerr)
	}
	if calls.Load() != 1 {
		t.Fatalf("fresh cache should not be revalidated, calls = %d", calls.Load())
	}
}

func TestTTMLLyricHitCacheSkipsRevalidate(t *testing.T) {
	server, calls := ttmlServer(t, http.StatusOK, testTTML)
	setupTTMLTest(t, "", server.URL)
	seedTTMLHit(12, testTTML, 0)
	s := NewMusicService()

	for range 2 {
		if got, svcerr := s.GetTTMLLyric(context.Background(), 12, musicTTMLSourceAMLL); svcerr != nil || got.TTML != testTTML {
			t.Fatalf("hit = %+v, %v", got, svcerr)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("hit within interval should not request upstream, calls = %d", calls.Load())
	}
}

func TestTTMLLyricRefreshRevalidatesHit(t *testing.T) {
	body := strings.Replace(testTTML, "hi", "old", 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	setupTTMLTest(t, "", server.URL)
	s := NewMusicService()

	if got, svcerr := s.GetTTMLLyric(context.Background(), 13, musicTTMLSourceAMLL); svcerr != nil || !strings.Contains(got.TTML, "old") {
		t.Fatalf("first = %+v, %v", got, svcerr)
	}
	// 上游换了文件，但缓存还没到复核时间：不请求，仍是旧歌词
	body = strings.Replace(testTTML, "hi", "new", 1)
	if got, _ := s.GetTTMLLyric(context.Background(), 13, musicTTMLSourceAMLL); !strings.Contains(got.TTML, "old") {
		t.Fatalf("cached = %q", got.TTML)
	}
	// 普通用户「重新获取歌词」不让命中的缓存提前复核
	if got, _ := s.GetTTMLLyric(WithLyricRefresh(context.Background(), "ttml", 13), 13, musicTTMLSourceAMLL); !strings.Contains(got.TTML, "old") {
		t.Fatalf("plain refresh = %q", got.TTML)
	}
	// 管理员「重新获取歌词」：立即复核并更新
	refreshCtx := withLyricRefresh(context.Background(), "ttml", 13, true)
	if got, svcerr := s.GetTTMLLyric(refreshCtx, 13, musicTTMLSourceAMLL); svcerr != nil || !strings.Contains(got.TTML, "new") {
		t.Fatalf("refreshed = %+v, %v", got, svcerr)
	}
}

func TestTTMLLyricRevalidateErrorKeepsCache(t *testing.T) {
	failing, calls := ttmlServer(t, http.StatusBadGateway, "")
	setupTTMLTest(t, "", failing.URL)
	seedTTMLHit(14, testTTML, 2*lyricRevalidateInterval)

	// 复核时上游出错：继续用已缓存的歌词，不把缓存清掉；之后按退避不再每次请求上游
	got, svcerr := NewMusicService().GetTTMLLyric(context.Background(), 14, musicTTMLSourceAMLL)
	if svcerr != nil || got.TTML != testTTML {
		t.Fatalf("got %+v, %v, want cached ttml", got, svcerr)
	}
	waitLyricCondition(t, "ttml failed revalidation", func() bool { return calls.Load() > 0 })
	waitLyricRevalidateIdle(t)
	after := calls.Load()
	for range 3 {
		if got, svcerr := NewMusicService().GetTTMLLyric(context.Background(), 14, musicTTMLSourceAMLL); svcerr != nil || got.TTML != testTTML {
			t.Fatalf("backoff = %+v, %v", got, svcerr)
		}
	}
	time.Sleep(50 * time.Millisecond)
	if calls.Load() != after {
		t.Fatalf("failed revalidation should back off, extra calls = %d", calls.Load()-after)
	}
	if entry := loadTTMLCacheEntry(musicTTMLCache, ttmlCacheKey(musicTTMLSourceAMLL, 14)); !entry.ok || entry.entry.TTML != testTTML {
		t.Fatalf("cache should be kept, entry = %+v", entry)
	}
}

func TestClearTTMLCache(t *testing.T) {
	missKey := ttmlCacheKey(musicTTMLSourceCustom, 88)
	storeTTMLCache(musicTTMLCache, missKey, musicTTMLCacheEntry{MissUntil: time.Now().Add(musicTTMLMissTTL).Unix()})
	storeTTMLCache(musicQQTTMLCache, 99, musicTTMLCacheEntry{MissUntil: time.Now().Add(musicTTMLMissTTL).Unix()})

	if !loadTTMLCacheEntry(musicTTMLCache, missKey).ok || !loadTTMLCacheEntry(musicQQTTMLCache, 99).ok {
		t.Fatal("expected negative cache entries to be stored")
	}

	NewMusicService().ClearTTMLCache()

	if loadTTMLCacheEntry(musicTTMLCache, missKey).ok || loadTTMLCacheEntry(musicQQTTMLCache, 99).ok {
		t.Fatal("expected TTML negative caches to be cleared")
	}
}
