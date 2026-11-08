package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWithLyricRefreshThrottle(t *testing.T) {
	ctx := context.Background()
	if lyricRefreshing(ctx) {
		t.Fatal("plain context should not refresh")
	}
	if !lyricRefreshing(WithLyricRefresh(ctx, "test", 42)) {
		t.Fatal("first refresh should bypass the miss cache")
	}
	// 同一来源同一首歌在节流时间内不再绕过缓存，其他来源不受影响
	if lyricRefreshing(WithLyricRefresh(ctx, "test", 42)) || !lyricRefreshing(WithLyricRefresh(ctx, "other", 42)) {
		t.Fatal("refresh should be throttled per source and song")
	}
	lyricRefreshAt.Store("test:42", time.Now().Add(-lyricRefreshInterval-time.Second))
	if !lyricRefreshing(WithLyricRefresh(ctx, "test", 42)) {
		t.Fatal("refresh should be allowed again after the interval")
	}
}

func TestProbeTTMLRefreshSkipsMiss(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0" end="1">晴天</p></div></body></tt>`))
	}))
	defer server.Close()
	const key = 987654321
	storeTTMLCache(musicTTMLCache, key, musicTTMLCacheEntry{MissUntil: time.Now().Add(time.Hour).Unix()})
	defer musicTTMLCache.Remove(key)

	// 平时使用「确定未命中」的缓存
	if probe := probeTTML(context.Background(), musicTTMLCache, key, "test-refresh-plain", []string{server.URL}); probe == nil || !probe.miss {
		t.Fatalf("cached miss should be used, got %+v", probe)
	}
	// 刷新时重新探测
	ctx := context.WithValue(context.Background(), lyricRefreshKey{}, true)
	if probe := probeTTML(ctx, musicTTMLCache, key, "test-refresh-forced", []string{server.URL}); probe == nil || probe.ttml == "" {
		t.Fatalf("refresh should refetch, got %+v", probe)
	}
}

func TestLyricCacheNeedsRevalidate(t *testing.T) {
	ctx := context.Background()
	now := time.Now()
	// 没有摘要的旧条目：复核一次
	if !lyricCacheNeedsRevalidate(ctx, now.Unix(), false) {
		t.Fatal("entry without digest should be revalidated")
	}
	if lyricCacheNeedsRevalidate(ctx, now.Unix(), true) {
		t.Fatal("fresh cache should not be revalidated")
	}
	if !lyricCacheNeedsRevalidate(ctx, now.Add(-lyricRevalidateInterval-time.Minute).Unix(), true) {
		t.Fatal("cache older than the interval should be revalidated")
	}
	// 刷新歌词时立即复核
	if !lyricCacheNeedsRevalidate(WithLyricRefresh(ctx, "test", 7), now.Unix(), true) {
		t.Fatal("refresh should revalidate immediately")
	}
}

// TestWithLyricRefreshAdminForces 管理员触发「重新获取歌词」是强制复核：不受节流与缓存有效期限制，且带 force 标记
func TestWithLyricRefreshAdminForces(t *testing.T) {
	_, admin, _, _, _ := setupEditTest(t)
	// 普通用户与访客只绕过一次缓存，受节流限制
	ctx := context.Background()
	if lyricForced(WithLyricRefresh(ctx, "force-plain", 1)) {
		t.Fatal("plain refresh should not force")
	}
	if lyricRefreshing(WithLyricRefresh(ctx, "force-plain", 1)) {
		t.Fatal("plain refresh should be throttled")
	}
	// 管理员：不节流、连缓存有效期也不信
	for i := range 3 {
		forced := WithLyricRefresh(admin, "force-admin", 1)
		if !lyricRefreshing(forced) || !lyricForced(forced) {
			t.Fatalf("admin refresh %d should force revalidation", i)
		}
	}
}

// TestMusicLyricAdminForceBypassesCache 管理员强制复核时不读缓存有效期，普通用户仍按间隔复核
func TestMusicLyricAdminForceBypassesCache(t *testing.T) {
	_, admin, _, _, _ := setupEditTest(t)
	var body atomic.Value
	body.Store("[00:01.00]你好")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "lrc": map[string]any{"lyric": body.Load(), "version": 1}})
	}))
	t.Cleanup(server.Close)
	original := musicLyricFallbackURL
	musicLyricFallbackURL = server.URL + "/fallback"
	t.Cleanup(func() { musicLyricFallbackURL = original })
	setMusicKV(t, map[string]any{"ncm_api_base_url": server.URL, "ncm_cookie": "abc"})
	musicLyricCache.Clear()
	s := NewMusicService()

	if lyric, svcerr := s.GetLyric(context.Background(), 202); svcerr != nil || lyric.Lrc.Lyric != "[00:01.00]你好" {
		t.Fatalf("first = %+v, %v", lyric, svcerr)
	}
	// 上游改了时间轴、缓存还在有效期内：普通用户拿不到新歌词
	body.Store("[00:01.30]你好")
	if lyric, _ := s.GetLyric(context.Background(), 202); lyric.Lrc.Lyric != "[00:01.00]你好" {
		t.Fatalf("plain user should read the cache: %+v", lyric)
	}
	// 管理员点「重新获取歌词」：不等复核间隔，立即向上游确认并更新
	if lyric, svcerr := s.GetLyric(WithLyricRefresh(admin, "ncm", 202), 202); svcerr != nil || lyric.Lrc.Lyric != "[00:01.30]你好" {
		t.Fatalf("admin forced = %+v, %v", lyric, svcerr)
	}
	// 上游没变时再点一次：内容相同，缓存写回同样的内容
	if lyric, svcerr := s.GetLyric(WithLyricRefresh(admin, "ncm", 202), 202); svcerr != nil || lyric.Lrc.Lyric != "[00:01.30]你好" {
		t.Fatalf("admin forced again = %+v, %v", lyric, svcerr)
	}
}

// TestStreamLyricsAdminRefreshForces 歌词流上，管理员点「重新获取歌词」时各来源的获取上下文带 force（不读缓存有效期），
// 普通用户只带 refresh（按复核间隔与节流）
func TestStreamLyricsAdminRefreshForces(t *testing.T) {
	_, admin, _, _, _ := setupEditTest(t)
	originalFetch, originalPersist, originalTimeout := lyricSourceFetch, lyricVersionPersistable, lyricStreamSourceTimeout
	var mu sync.Mutex
	forced := map[string]bool{}
	refreshing := map[string]bool{}
	lyricSourceFetch = func(_ *MusicService, ctx context.Context, _ int64, kind string) lyricSourceResult {
		mu.Lock()
		defer mu.Unlock()
		forced[kind] = lyricForced(ctx)
		refreshing[kind] = lyricRefreshing(ctx)
		return lyricSourceResult{kind: kind}
	}
	lyricVersionPersistable = func(*MusicService, context.Context, int64) bool { return false }
	lyricStreamSourceTimeout = time.Second
	t.Cleanup(func() {
		lyricSourceFetch, lyricVersionPersistable, lyricStreamSourceTimeout = originalFetch, originalPersist, originalTimeout
	})
	send := func(string, any) error { return nil }

	NewMusicService().StreamLyrics(admin, 71, true, send)
	if len(forced) != len(lyricSourceKinds) {
		t.Fatalf("sources fetched = %d", len(forced))
	}
	for _, kind := range lyricSourceKinds {
		if !refreshing[kind] || !forced[kind] {
			t.Fatalf("admin refresh should force %s: refreshing=%t forced=%t", kind, refreshing[kind], forced[kind])
		}
	}
	// 普通用户：刷新时立即复核，但不强制（仍按复核间隔与缓存有效期）
	mu.Lock()
	clear(refreshing)
	clear(forced)
	mu.Unlock()
	NewMusicService().StreamLyrics(context.Background(), 72, true, send)
	for _, kind := range lyricSourceKinds {
		if !refreshing[kind] || forced[kind] {
			t.Fatalf("plain refresh of %s should not force: refreshing=%t forced=%t", kind, refreshing[kind], forced[kind])
		}
	}
	// 管理员平时打开一首歌（没有点「重新获取歌词」）：既不复核也不强制
	mu.Lock()
	clear(refreshing)
	clear(forced)
	mu.Unlock()
	NewMusicService().StreamLyrics(admin, 73, false, send)
	for _, kind := range lyricSourceKinds {
		if refreshing[kind] || forced[kind] {
			t.Fatalf("opening a song should not refresh %s: refreshing=%t forced=%t", kind, refreshing[kind], forced[kind])
		}
	}
}
