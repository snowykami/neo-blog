package service

import (
	"context"
	"net/http"
	"net/http/httptest"
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
