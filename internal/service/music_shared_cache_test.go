package service

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 配置 Redis（NEO_TEST_REDIS_URL）时，歌单与播放地址在实例间共享：本实例的缓存清空后（相当于新实例或滚动更新后）
// 直接读取共享缓存，不再请求网易云
func TestMusicSharedCacheAcrossInstances(t *testing.T) {
	url := os.Getenv("NEO_TEST_REDIS_URL")
	if url == "" {
		t.Skip("NEO_TEST_REDIS_URL not set")
	}
	setupEditTest(t)
	if err := sharedstate.Init(url, fmt.Sprintf("neo-blog-test:%d:", time.Now().UnixNano())); err != nil {
		t.Fatalf("init redis: %v", err)
	}
	t.Cleanup(sharedstate.UseMemory)
	srv, calls := fakeNCMServer(t)
	s := NewMusicService()
	ctx := context.Background()
	setMusicKV(t, map[string]any{"ncm_api_base_url": srv.URL, "ncm_cookie": "abc", "ncm_playlist_id": float64(7044354223), "ncm_song_level": ""})

	if tracks, svcerr := s.GetPlaylist(ctx); svcerr != nil || len(tracks) != 2 {
		t.Fatalf("playlist: %v %d", svcerr, len(tracks))
	}
	if _, svcerr := s.GetSongURL(ctx, 1, ""); svcerr != nil {
		t.Fatalf("song url: %v", svcerr)
	}

	musicState.Lock()
	musicState.key, musicState.tracks, musicState.songURLs = "", nil, nil
	musicState.Unlock()

	if tracks, svcerr := s.GetPlaylist(ctx); svcerr != nil || len(tracks) != 2 {
		t.Fatalf("playlist from shared cache: %v %d", svcerr, len(tracks))
	}
	if songURL, svcerr := s.GetSongURL(ctx, 1, ""); svcerr != nil || songURL != "https://m701.music.126.net/1-exhigh.mp3" {
		t.Fatalf("song url from shared cache: %v %q", svcerr, songURL)
	}
	if got := calls["/playlist/track/all"].Load(); got != 1 {
		t.Fatalf("playlist fetched %d times, want 1", got)
	}
	if got := calls["/song/url/v1"].Load(); got != 1 {
		t.Fatalf("song url fetched %d times, want 1", got)
	}
}
