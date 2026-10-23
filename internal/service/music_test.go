package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
)

// fakeNCMServer 模拟 NeteaseCloudMusicApi Enhanced 的几个接口，记录各接口的调用次数
func fakeNCMServer(t *testing.T) (*httptest.Server, map[string]*atomic.Int32) {
	t.Helper()
	calls := map[string]*atomic.Int32{}
	for _, path := range []string{"/user/account", "/user/playlist", "/playlist/track/all", "/song/url/v1", "/lyric/new", "/fallback", "/song/detail", "/fallback-song"} {
		calls[path] = &atomic.Int32{}
	}
	write := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(v)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if counter, ok := calls[r.URL.Path]; ok {
			counter.Add(1)
		}
		loggedIn := r.Header.Get("Cookie") == "MUSIC_U=abc"
		switch r.URL.Path {
		case "/user/account":
			if !loggedIn {
				write(w, map[string]any{"code": 200, "profile": nil})
				return
			}
			write(w, map[string]any{"code": 200, "profile": map[string]any{"userId": 42, "nickname": "雪", "avatarUrl": "http://p1.music.126.net/a.jpg"}})
		case "/user/playlist":
			if r.URL.Query().Get("uid") != "42" {
				t.Errorf("unexpected uid %q", r.URL.Query().Get("uid"))
			}
			write(w, map[string]any{"code": 200, "playlist": []map[string]any{
				{"id": 7044354223, "name": "喜欢的音乐", "coverImgUrl": "http://p2.music.126.net/c.jpg", "trackCount": 3},
				{"id": 99, "name": "收藏", "trackCount": 1, "subscribed": true},
			}})
		case "/playlist/track/all":
			if !loggedIn || r.URL.Query().Get("id") != "7044354223" {
				write(w, map[string]any{"code": 404, "message": "playlist not found"})
				return
			}
			write(w, map[string]any{
				"code": 200,
				"songs": []map[string]any{
					{"id": 1, "name": "空中散歩", "ar": []map[string]any{{"name": "CIEL"}}, "al": map[string]any{"name": "空想少女", "picUrl": "http://p4.music.126.net/x.jpg"}, "alia": []string{"空中散步"}},
					{"id": 2, "name": "纯音乐", "ar": []map[string]any{{"name": "A"}, {"name": "B"}}, "al": map[string]any{"name": "专辑"}, "tns": []string{"Instrumental"}},
					{"id": 3, "name": "已下架", "ar": []map[string]any{}, "al": map[string]any{}},
				},
				"privileges": []map[string]any{{"id": 1, "st": 0}, {"id": 2, "st": 0}, {"id": 3, "st": -200}},
			})
		case "/song/url/v1":
			if !loggedIn {
				t.Errorf("song url should carry cookie")
			}
			// 地址中带上请求的音质，便于检查
			write(w, map[string]any{"code": 200, "data": []map[string]any{{"id": 1, "url": "http://m701.music.126.net/1-" + r.URL.Query().Get("level") + ".mp3", "expi": 1200}}})
		case "/lyric/new":
			if r.Header.Get("Cookie") != "" {
				t.Errorf("lyric request should not carry cookie")
			}
			if r.URL.Query().Get("id") == "2" {
				write(w, map[string]any{"code": 200, "nolyric": true})
				return
			}
			write(w, map[string]any{"code": 200, "lrc": map[string]any{"lyric": "[00:01.00]你好", "version": 3}, "tlyric": map[string]any{"lyric": "[00:01.00]hello", "version": 1}})
		case "/fallback":
			write(w, map[string]any{"code": 200, "lrc": map[string]any{"lyric": "[00:01.00]fallback", "version": 1}})
		case "/song/detail":
			if r.Header.Get("Cookie") != "" {
				t.Errorf("song detail request should not carry cookie")
			}
			if r.URL.Query().Get("ids") != "1" {
				write(w, map[string]any{"code": 200, "songs": []any{}})
				return
			}
			write(w, map[string]any{"code": 200, "songs": []map[string]any{
				{"id": 1, "name": "空中散歩", "ar": []map[string]any{{"name": "CIEL"}}, "al": map[string]any{"name": "空想少女", "picUrl": "http://p4.music.126.net/x.jpg"}},
			}})
		case "/fallback-song":
			// 网易云旧接口：artists / album
			write(w, map[string]any{"code": 200, "songs": []map[string]any{
				{"id": 202, "name": "旧接口", "artists": []map[string]any{{"name": "A"}, {"name": "B"}}, "album": map[string]any{"name": "专辑", "picUrl": "http://p3.music.126.net/y.jpg"}},
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, calls
}

func setMusicKV(t *testing.T, kv map[string]any) {
	t.Helper()
	for key, value := range kv {
		if err := repo.KV.SetKV(key, value); err != nil {
			t.Fatalf("set %s: %v", key, err)
		}
	}
}

func TestMusicListNCMPlaylists(t *testing.T) {
	setupEditTest(t)
	srv, _ := fakeNCMServer(t)
	s := NewMusicService()
	ctx := context.Background()
	setMusicKV(t, map[string]any{"ncm_api_base_url": "", "ncm_cookie": "", "ncm_playlist_id": 0})

	// 参数校验：API 地址必须是 http(s) 地址，Cookie 必填
	_, svcerr := s.ListNCMPlaylists(ctx, &dto.NCMPlaylistsReq{APIBaseURL: "ftp://x", Cookie: "abc"})
	expectCode(t, svcerr, http.StatusBadRequest, "invalid api url")
	_, svcerr = s.ListNCMPlaylists(ctx, &dto.NCMPlaylistsReq{APIBaseURL: srv.URL})
	expectCode(t, svcerr, http.StatusBadRequest, "missing cookie")
	_, svcerr = s.ListNCMPlaylists(ctx, &dto.NCMPlaylistsReq{APIBaseURL: srv.URL, Cookie: "wrong"})
	expectCode(t, svcerr, http.StatusBadRequest, "invalid cookie")

	// 只填写 MUSIC_U 的值时自动补全键名
	result, svcerr := s.ListNCMPlaylists(ctx, &dto.NCMPlaylistsReq{APIBaseURL: srv.URL + "/", Cookie: " abc "})
	if svcerr != nil {
		t.Fatalf("list playlists: %v", svcerr)
	}
	if result.Account.Nickname != "雪" || result.Account.Avatar != "https://p1.music.126.net/a.jpg" || len(result.Playlists) != 2 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if p := result.Playlists[0]; p.ID != 7044354223 || p.Cover != "https://p2.music.126.net/c.jpg" || p.TrackCount != 3 || p.Subscribed {
		t.Fatalf("unexpected playlist: %+v", p)
	}

	// 请求中未填写时使用已保存的配置
	setMusicKV(t, map[string]any{"ncm_api_base_url": srv.URL, "ncm_cookie": "MUSIC_U=abc"})
	if _, svcerr = s.ListNCMPlaylists(ctx, &dto.NCMPlaylistsReq{}); svcerr != nil {
		t.Fatalf("list with saved config: %v", svcerr)
	}

	// API 不可用
	_, svcerr = s.ListNCMPlaylists(ctx, &dto.NCMPlaylistsReq{APIBaseURL: "http://127.0.0.1:1"})
	expectCode(t, svcerr, http.StatusBadGateway, "api unavailable")
}

func TestMusicPlaylistAndSongURL(t *testing.T) {
	setupEditTest(t)
	srv, calls := fakeNCMServer(t)
	s := NewMusicService()
	ctx := context.Background()

	// 未选择歌单时不提供
	setMusicKV(t, map[string]any{"ncm_api_base_url": srv.URL, "ncm_cookie": "abc", "ncm_playlist_id": 0, "ncm_song_level": ""})
	_, svcerr := s.GetPlaylist(ctx)
	expectCode(t, svcerr, http.StatusNotFound, "not configured")

	setMusicKV(t, map[string]any{"ncm_playlist_id": float64(7044354223)})
	tracks, svcerr := s.GetPlaylist(ctx)
	if svcerr != nil {
		t.Fatalf("playlist: %v", svcerr)
	}
	// 已下架的歌曲被过滤
	if len(tracks) != 2 {
		t.Fatalf("expected 2 tracks, got %+v", tracks)
	}
	first := tracks[0]
	if first.ID != 1 || first.Audio != "/api/v1/music/song/1/audio" || first.Lyric != "/api/v1/music/song/1/lyric" ||
		first.AlbumPic != "https://p4.music.126.net/x.jpg" || first.Link != "https://music.163.com/#/song?id=1" ||
		strings.Join(first.Artists, ",") != "CIEL" || strings.Join(first.Aliases, ",") != "空中散步" {
		t.Fatalf("unexpected track: %+v", first)
	}
	if strings.Join(tracks[1].Artists, ",") != "A,B" || strings.Join(tracks[1].Aliases, ",") != "Instrumental" {
		t.Fatalf("unexpected track: %+v", tracks[1])
	}
	// 缓存期内不再请求
	if _, svcerr = s.GetPlaylist(ctx); svcerr != nil || calls["/playlist/track/all"].Load() != 1 {
		t.Fatalf("playlist should be cached: %v %d", svcerr, calls["/playlist/track/all"].Load())
	}

	// 只能获取歌单内歌曲的播放地址
	_, svcerr = s.GetSongURL(ctx, 12345)
	expectCode(t, svcerr, http.StatusNotFound, "song outside playlist")
	_, svcerr = s.GetSongURL(ctx, 3)
	expectCode(t, svcerr, http.StatusNotFound, "removed song")
	// 未配置音质时使用默认的 exhigh
	songURL, svcerr := s.GetSongURL(ctx, 1)
	if svcerr != nil || songURL != "https://m701.music.126.net/1-exhigh.mp3" {
		t.Fatalf("song url: %v %q", svcerr, songURL)
	}
	if _, svcerr = s.GetSongURL(ctx, 1); svcerr != nil || calls["/song/url/v1"].Load() != 1 {
		t.Fatalf("song url should be cached: %v %d", svcerr, calls["/song/url/v1"].Load())
	}
	// 修改音质后不使用旧音质的缓存
	setMusicKV(t, map[string]any{"ncm_song_level": "lossless"})
	if songURL, svcerr = s.GetSongURL(ctx, 1); svcerr != nil || songURL != "https://m701.music.126.net/1-lossless.mp3" || calls["/song/url/v1"].Load() != 2 {
		t.Fatalf("lossless song url: %v %q %d", svcerr, songURL, calls["/song/url/v1"].Load())
	}
	// 不在可选范围内的音质按默认音质处理
	setMusicKV(t, map[string]any{"ncm_song_level": "jymaster"})
	if songURL, svcerr = s.GetSongURL(ctx, 1); svcerr != nil || songURL != "https://m701.music.126.net/1-exhigh.mp3" {
		t.Fatalf("invalid level should fall back: %v %q", svcerr, songURL)
	}

	// 过期后先返回旧数据，并在后台刷新一次
	musicState.Lock()
	musicState.fetchedAt = time.Now().Add(-musicPlaylistTTL)
	musicState.Unlock()
	for range 3 {
		if stale, svcerr := s.GetPlaylist(ctx); svcerr != nil || len(stale) != 2 {
			t.Fatalf("stale playlist: %v %d", svcerr, len(stale))
		}
	}
	deadline := time.Now().Add(2 * time.Second)
	for calls["/playlist/track/all"].Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	musicFetchMu.Lock() // 等待后台刷新写回
	musicFetchMu.Unlock()
	musicState.Lock()
	refreshed := time.Since(musicState.fetchedAt) < time.Minute && !musicState.refreshing
	musicState.Unlock()
	if calls["/playlist/track/all"].Load() != 2 || !refreshed {
		t.Fatalf("expected one background refresh, calls=%d refreshed=%v", calls["/playlist/track/all"].Load(), refreshed)
	}

	// 配置变化后按新配置重新获取
	setMusicKV(t, map[string]any{"ncm_cookie": "wrong"})
	_, svcerr = s.GetPlaylist(ctx)
	expectCode(t, svcerr, http.StatusBadGateway, "new config fetch failed")
}

func TestMusicLyric(t *testing.T) {
	setupEditTest(t)
	srv, calls := fakeNCMServer(t)
	s := NewMusicService()
	ctx := context.Background()
	setMusicKV(t, map[string]any{"ncm_api_base_url": srv.URL, "ncm_cookie": "abc"})
	musicLyricCache.Clear()

	lyric, svcerr := s.GetLyric(ctx, 101)
	if svcerr != nil || lyric.Lrc.Lyric != "[00:01.00]你好" || lyric.Lrc.Version != 3 || lyric.Tlyric == nil || lyric.Yrc != nil {
		t.Fatalf("lyric: %v %+v", svcerr, lyric)
	}
	if _, svcerr = s.GetLyric(ctx, 101); svcerr != nil || calls["/lyric/new"].Load() != 1 {
		t.Fatalf("lyric should be cached: %v %d", svcerr, calls["/lyric/new"].Load())
	}
	// 纯音乐返回占位歌词
	if lyric, svcerr = s.GetLyric(ctx, 2); svcerr != nil || lyric.Lrc.Lyric != "[00:00.00]pure_music_without_lyric" {
		t.Fatalf("pure music: %v %+v", svcerr, lyric)
	}

	// 未配置 API 时直接请求网易云
	original := musicLyricFallbackURL
	musicLyricFallbackURL = srv.URL + "/fallback"
	t.Cleanup(func() { musicLyricFallbackURL = original })
	setMusicKV(t, map[string]any{"ncm_api_base_url": ""})
	if lyric, svcerr = s.GetLyric(ctx, 102); svcerr != nil || lyric.Lrc.Lyric != "[00:01.00]fallback" || calls["/fallback"].Load() != 1 {
		t.Fatalf("fallback lyric: %v %+v", svcerr, lyric)
	}
}

func TestMusicSong(t *testing.T) {
	setupEditTest(t)
	srv, calls := fakeNCMServer(t)
	s := NewMusicService()
	ctx := context.Background()
	setMusicKV(t, map[string]any{"ncm_api_base_url": srv.URL, "ncm_cookie": "abc"})
	musicSongCache.Clear()

	_, svcerr := s.GetSong(ctx, 0)
	expectCode(t, svcerr, http.StatusBadRequest, "invalid id")

	// 任意歌曲都可查询公开信息（不携带 Cookie），结果缓存
	song, svcerr := s.GetSong(ctx, 1)
	if svcerr != nil || song.Name != "空中散歩" || strings.Join(song.Artists, ",") != "CIEL" || song.Album != "空想少女" ||
		song.AlbumPic != "https://p4.music.126.net/x.jpg" || song.Link != "https://music.163.com/#/song?id=1" {
		t.Fatalf("song: %v %+v", svcerr, song)
	}
	if _, svcerr = s.GetSong(ctx, 1); svcerr != nil || calls["/song/detail"].Load() != 1 {
		t.Fatalf("song should be cached: %v %d", svcerr, calls["/song/detail"].Load())
	}

	// 未配置 API 时直接请求网易云旧接口；返回的歌曲与请求不符时视为不存在
	original := musicSongFallbackURL
	musicSongFallbackURL = srv.URL + "/fallback-song"
	t.Cleanup(func() { musicSongFallbackURL = original })
	setMusicKV(t, map[string]any{"ncm_api_base_url": ""})
	song, svcerr = s.GetSong(ctx, 202)
	if svcerr != nil || song.Name != "旧接口" || strings.Join(song.Artists, ",") != "A,B" || song.AlbumPic != "https://p3.music.126.net/y.jpg" {
		t.Fatalf("fallback song: %v %+v", svcerr, song)
	}
	_, svcerr = s.GetSong(ctx, 203)
	expectCode(t, svcerr, http.StatusNotFound, "mismatched song")
}
