package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func TestWithLyricRefreshThrottle(t *testing.T) {
	ctx := context.Background()
	t.Cleanup(func() {
		_ = sharedstate.Current().Delete(lyricRefreshKeyPrefix+"test:42", lyricRefreshKeyPrefix+"other:42")
	})
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
	// 节流记在 sharedstate：键过期（这里直接删除）后可以再绕过一次
	if err := sharedstate.Current().Delete(lyricRefreshKeyPrefix + "test:42"); err != nil {
		t.Fatal(err)
	}
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

func TestLyricCacheStale(t *testing.T) {
	now := time.Now()
	// 没有摘要的旧条目：复核一次
	if !lyricCacheStale(now.Unix(), false) {
		t.Fatal("entry without digest should be revalidated")
	}
	if lyricCacheStale(now.Unix(), true) {
		t.Fatal("fresh cache should not be revalidated")
	}
	if !lyricCacheStale(now.Add(-lyricRevalidateInterval-time.Minute).Unix(), true) {
		t.Fatal("cache older than the interval should be revalidated")
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

// resetLyricSharedState 换一份新的进程内 sharedstate：读者刷新的节流、后台复核的占用与退避不在测试之间残留
func resetLyricSharedState(t *testing.T) {
	t.Helper()
	sharedstate.UseMemory()
	t.Cleanup(sharedstate.UseMemory)
}

// waitLyricCondition 轮询等待后台复核的结果（最多 3 秒）
func waitLyricCondition(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// waitLyricRevalidateIdle 等本实例的后台复核全部结束
func waitLyricRevalidateIdle(t *testing.T) {
	t.Helper()
	waitLyricCondition(t, "background revalidation to finish", func() bool { return lyricRevalidateRunning.Load() == 0 })
}

// TestRevalidateLyricInBackgroundDedupe 同一个 key 的并发复核只执行一次；成功后释放占用，之后可以再次复核
func TestRevalidateLyricInBackgroundDedupe(t *testing.T) {
	resetLyricSharedState(t)
	release := make(chan struct{})
	var runs atomic.Int32
	run := func(ctx context.Context) error {
		runs.Add(1)
		if _, ok := ctx.Deadline(); !ok {
			t.Error("background revalidation should carry a deadline")
		}
		<-release
		return nil
	}
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			revalidateLyricInBackground("test:dedupe", run)
		}()
	}
	wg.Wait()
	waitLyricCondition(t, "the first run", func() bool { return runs.Load() == 1 })
	// 跨实例的占用记在 sharedstate
	if _, ok, _ := sharedstate.Current().Get(lyricRevalidateKeyPrefix + "test:dedupe"); !ok {
		t.Fatal("revalidation should hold a shared claim while running")
	}
	close(release)
	waitLyricRevalidateIdle(t)
	if runs.Load() != 1 {
		t.Fatalf("concurrent revalidations should run once, runs = %d", runs.Load())
	}
	if _, ok, _ := sharedstate.Current().Get(lyricRevalidateKeyPrefix + "test:dedupe"); ok {
		t.Fatal("successful revalidation should release the claim")
	}
	revalidateLyricInBackground("test:dedupe", run)
	waitLyricRevalidateIdle(t)
	if runs.Load() != 2 {
		t.Fatalf("revalidation should run again after release, runs = %d", runs.Load())
	}
}

// TestRevalidateLyricInBackgroundBackoff 复核失败（出错或 panic）后进入退避：占用保留，期间不再复核；其他 key 不受影响
func TestRevalidateLyricInBackgroundBackoff(t *testing.T) {
	resetLyricSharedState(t)
	var runs atomic.Int32
	failing := func(context.Context) error {
		runs.Add(1)
		return errors.New("upstream down")
	}
	panicking := func(context.Context) error {
		runs.Add(1)
		panic("boom")
	}
	revalidateLyricInBackground("test:error", failing)
	revalidateLyricInBackground("test:panic", panicking)
	waitLyricCondition(t, "both runs", func() bool { return runs.Load() == 2 })
	waitLyricRevalidateIdle(t)
	for range 5 {
		revalidateLyricInBackground("test:error", failing)
		revalidateLyricInBackground("test:panic", panicking)
	}
	waitLyricRevalidateIdle(t)
	if runs.Load() != 2 {
		t.Fatalf("failed revalidation should back off, runs = %d", runs.Load())
	}
	for _, key := range []string{"test:error", "test:panic"} {
		if _, ok, _ := sharedstate.Current().Get(lyricRevalidateKeyPrefix + key); !ok {
			t.Fatalf("%s should keep the backoff claim", key)
		}
	}
	// 退避过期（这里直接删除）后再次复核
	_ = sharedstate.Current().Delete(lyricRevalidateKeyPrefix + "test:error")
	revalidateLyricInBackground("test:error", func(context.Context) error { runs.Add(1); return nil })
	waitLyricRevalidateIdle(t)
	if runs.Load() != 3 {
		t.Fatalf("revalidation should run after backoff expires, runs = %d", runs.Load())
	}
}

// TestMusicLyricStaleWhileRevalidate 缓存到了复核时间、上游很慢：请求立即拿到缓存，不等上游；
// 并发请求只触发一次上游请求，后台复核完成后缓存换成新内容
func TestMusicLyricStaleWhileRevalidate(t *testing.T) {
	setupEditTest(t)
	resetLyricSharedState(t)
	var body atomic.Value
	body.Store("[00:01.00]你好")
	release := make(chan struct{})
	var blocking atomic.Bool
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		if blocking.Load() {
			<-release
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "lrc": map[string]any{"lyric": body.Load(), "version": 1}})
	}))
	t.Cleanup(server.Close)
	t.Cleanup(func() {
		if blocking.Load() {
			close(release)
		}
	})
	original := musicLyricFallbackURL
	musicLyricFallbackURL = server.URL + "/fallback"
	t.Cleanup(func() { musicLyricFallbackURL = original })
	setMusicKV(t, map[string]any{"ncm_api_base_url": server.URL, "ncm_cookie": "abc"})
	musicLyricCache.Clear()
	s := NewMusicService()

	if lyric, svcerr := s.GetLyric(context.Background(), 203); svcerr != nil || lyric.Lrc.Lyric != "[00:01.00]你好" {
		t.Fatalf("first = %+v, %v", lyric, svcerr)
	}
	seedLyricCheckedAt(t, 203, 2*lyricRevalidateInterval)
	body.Store("[00:01.50]你好")
	blocking.Store(true)
	before := calls.Load()

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			start := time.Now()
			lyric, svcerr := s.GetLyric(context.Background(), 203)
			if svcerr != nil || lyric.Lrc.Lyric != "[00:01.00]你好" {
				t.Errorf("stale = %+v, %v", lyric, svcerr)
			}
			if elapsed := time.Since(start); elapsed > time.Second {
				t.Errorf("stale read should not wait for upstream, took %v", elapsed)
			}
		}()
	}
	wg.Wait()
	waitLyricCondition(t, "upstream request", func() bool { return calls.Load() > before })
	time.Sleep(50 * time.Millisecond)
	if got := calls.Load() - before; got != 1 {
		t.Fatalf("concurrent stale reads should trigger one upstream request, got %d", got)
	}
	blocking.Store(false)
	close(release)
	waitLyricCondition(t, "cache update", func() bool {
		entry, ok := loadMusicLyricCacheEntry(203)
		return ok && entry.Lyric.Lrc.Lyric == "[00:01.50]你好" && !lyricCacheStale(entry.CheckedAt, entry.Hash != "")
	})
	waitLyricRevalidateIdle(t)
}

// TestMusicLyricRefreshAuthorization 「重新获取歌词」：访客只能让「没有歌词」的缓存重新探测，且按 sharedstate 节流；
// 管理员每次都强制复核
func TestMusicLyricRefreshAuthorization(t *testing.T) {
	_, admin, _, _, _ := setupEditTest(t)
	resetLyricSharedState(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "lrc": map[string]any{"lyric": "[00:01.00]你好", "version": 1}})
	}))
	t.Cleanup(server.Close)
	original := musicLyricFallbackURL
	musicLyricFallbackURL = server.URL + "/fallback"
	t.Cleanup(func() { musicLyricFallbackURL = original })
	setMusicKV(t, map[string]any{"ncm_api_base_url": server.URL, "ncm_cookie": "abc"})
	musicLyricCache.Clear()
	s := NewMusicService()
	guest := context.Background()
	seedMiss := func() {
		storeMusicLyricCache(204, &dto.MusicLyricDto{Lrc: &dto.MusicLyricPart{Lyric: "[00:00.00]no_lyric", Version: 1}}, musicLyricMissTTL, true)
	}

	seedMiss()
	if lyric, _ := s.GetLyric(guest, 204); lyric.Lrc.Lyric != "[00:00.00]no_lyric" || calls.Load() != 0 {
		t.Fatalf("plain read should use the miss cache: %+v, calls = %d", lyric, calls.Load())
	}
	// 访客刷新：重新探测「没有歌词」的缓存
	if lyric, _ := s.GetLyric(WithLyricRefresh(guest, "ncm", 204), 204); lyric.Lrc.Lyric != "[00:01.00]你好" || calls.Load() != 1 {
		t.Fatalf("guest refresh should refetch the miss: %+v, calls = %d", lyric, calls.Load())
	}
	if _, ok, _ := sharedstate.Current().Get(lyricRefreshKeyPrefix + "ncm:204"); !ok {
		t.Fatal("guest refresh throttle should be recorded in sharedstate")
	}
	// 节流期间再刷新：照常读缓存，不请求上游
	seedMiss()
	if lyric, _ := s.GetLyric(WithLyricRefresh(guest, "ncm", 204), 204); lyric.Lrc.Lyric != "[00:00.00]no_lyric" || calls.Load() != 1 {
		t.Fatalf("throttled guest refresh should not refetch: %+v, calls = %d", lyric, calls.Load())
	}
	// 访客刷新不让命中的歌词提前复核（复核间隔内）
	_ = sharedstate.Current().Delete(lyricRefreshKeyPrefix + "ncm:204")
	storeMusicLyricCache(204, &dto.MusicLyricDto{Lrc: &dto.MusicLyricPart{Lyric: "[00:02.00]旧", Version: 1}}, musicLyricHitTTL, false)
	if lyric, _ := s.GetLyric(WithLyricRefresh(guest, "ncm", 204), 204); lyric.Lrc.Lyric != "[00:02.00]旧" || calls.Load() != 1 {
		t.Fatalf("guest refresh should not revalidate a fresh hit: %+v, calls = %d", lyric, calls.Load())
	}
	// 管理员：不节流，每次都问上游
	for i := range 3 {
		seedMiss()
		if lyric, _ := s.GetLyric(WithLyricRefresh(admin, "ncm", 204), 204); lyric.Lrc.Lyric != "[00:01.00]你好" || calls.Load() != int32(2+i) {
			t.Fatalf("admin refresh %d should force: %+v, calls = %d", i, lyric, calls.Load())
		}
	}
}
