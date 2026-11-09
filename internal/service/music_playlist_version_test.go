package service

import (
	"context"
	"testing"
)

// 歌单版本按内容计算：内容不变时不变（后端过期后重新拉一遍也不会变），内容变化时变化。
// 前端缓存了歌单后用版本判断要不要重新下载整份歌单，所以这个值必须稳定
func TestMusicPlaylistVersion(t *testing.T) {
	setupEditTest(t)
	srv, _ := fakeNCMServer(t)
	s := NewMusicService()
	ctx := context.Background()
	setMusicKV(t, map[string]any{"ncm_api_base_url": srv.URL, "ncm_cookie": "abc", "ncm_playlist_id": float64(7044354223), "ncm_song_level": ""})

	// 每个用例都从空的实例缓存开始，相当于另一个实例/重启后的进程
	resetMusicState := func() {
		musicState.Lock()
		musicState.key, musicState.tracks, musicState.version, musicState.songURLs = "", nil, "", nil
		musicState.Unlock()
	}
	t.Cleanup(resetMusicState)

	tracks, version, svcerr := s.GetPlaylistWithVersion(ctx)
	if svcerr != nil || len(tracks) != 2 || version == "" {
		t.Fatalf("playlist: %v %d %q", svcerr, len(tracks), version)
	}
	if got, svcerr := s.GetPlaylistVersion(ctx); svcerr != nil || got != version {
		t.Fatalf("playlist version = %q (%v), want %q", got, svcerr, version)
	}

	// 另一个实例重新拉同一份歌单：内容一样，版本必须一样，否则前端缓存会白作废
	resetMusicState()
	if _, again, svcerr := s.GetPlaylistWithVersion(ctx); svcerr != nil || again != version {
		t.Fatalf("version after refetch = %q (%v), want %q", again, svcerr, version)
	}

	// 歌单内容变化（站长增删歌曲）：版本跟着变
	musicState.Lock()
	key := musicState.key
	musicState.Unlock()
	changed := storePlaylist(key, tracks[:1])
	if changed == "" || changed == version {
		t.Fatalf("version after playlist changed = %q, want different from %q", changed, version)
	}
	if got, svcerr := s.GetPlaylistVersion(ctx); svcerr != nil || got != changed {
		t.Fatalf("playlist version after change = %q (%v), want %q", got, svcerr, changed)
	}

	// 未配置歌单时按原有行为返回 404
	resetMusicState()
	setMusicKV(t, map[string]any{"ncm_api_base_url": "", "ncm_playlist_id": float64(0)})
	if _, svcerr := s.GetPlaylistVersion(ctx); svcerr == nil {
		t.Fatal("version without configured playlist should fail")
	}
}
