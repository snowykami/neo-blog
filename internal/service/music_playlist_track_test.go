package service

import (
	"context"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
)

// 恢复播放只取一首：候选按优先级取第一首在歌单内的，都不在时取歌单第一首；不会返回歌单外的歌曲
func TestMusicPlaylistTrack(t *testing.T) {
	setupEditTest(t)
	srv, calls := fakeNCMServer(t)
	s := NewMusicService()
	ctx := context.Background()
	setMusicKV(t, map[string]any{"ncm_api_base_url": srv.URL, "ncm_cookie": "abc", "ncm_playlist_id": float64(7044354223), "ncm_song_level": ""})
	t.Cleanup(func() {
		musicState.Lock()
		musicState.key, musicState.tracks, musicState.version, musicState.songURLs = "", nil, "", nil
		musicState.Unlock()
	})

	cases := []struct {
		name string
		ids  []int64
		want int64
	}{
		{"no candidates", nil, 1},
		{"stored track", []int64{2}, 2},
		{"first candidate wins", []int64{2, 1}, 2},
		{"skip candidates outside playlist", []int64{12345, 2}, 2},
		// 已下架的歌曲不在歌单里，不能借这个接口取到
		{"removed song falls back to first", []int64{3}, 1},
	}
	for _, tc := range cases {
		track, svcerr := s.GetPlaylistTrack(ctx, tc.ids)
		if svcerr != nil || track == nil || track.ID != tc.want {
			t.Fatalf("%s: got %+v (%v), want id %d", tc.name, track, svcerr, tc.want)
		}
	}
	// 与完整歌单共用同一份缓存，不会为每次恢复重新向网易云获取
	if n := calls["/playlist/track/all"].Load(); n != 1 {
		t.Fatalf("playlist fetched %d times, want 1", n)
	}

	// 歌单为空时返回 nil
	musicState.Lock()
	key := musicState.key
	musicState.Unlock()
	storePlaylist(key, []dto.MusicTrackDto{})
	if track, svcerr := s.GetPlaylistTrack(ctx, []int64{1}); svcerr != nil || track != nil {
		t.Fatalf("empty playlist: got %+v (%v)", track, svcerr)
	}

	// 未配置歌单时与完整歌单一样返回错误
	setMusicKV(t, map[string]any{"ncm_api_base_url": "", "ncm_playlist_id": float64(0)})
	if _, svcerr := s.GetPlaylistTrack(ctx, nil); svcerr == nil {
		t.Fatal("track without configured playlist should fail")
	}
}
