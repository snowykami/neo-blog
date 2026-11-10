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
	"github.com/snowykami/neo-blog/internal/tools"
)

// fakeNCMServer 模拟 NeteaseCloudMusicApi Enhanced 的几个接口，记录各接口的调用次数
func fakeNCMServer(t *testing.T) (*httptest.Server, map[string]*atomic.Int32) {
	t.Helper()
	calls := map[string]*atomic.Int32{}
	for _, path := range []string{"/user/account", "/user/playlist", "/playlist/track/all", "/song/url/v1", "/lyric/new", "/fallback", "/song/detail", "/fallback-song", "/cloudsearch", "/search-fallback"} {
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
		case "/cloudsearch":
			if r.Header.Get("Cookie") != "" {
				t.Errorf("search should not carry cookie")
			}
			if r.URL.Query().Get("keywords") != "空中" || r.URL.Query().Get("type") != "1" {
				t.Errorf("unexpected search query %q", r.URL.RawQuery)
			}
			write(w, map[string]any{"code": 200, "result": map[string]any{"songs": []map[string]any{
				{"id": 1, "name": "空中散歩", "ar": []map[string]any{{"name": "CIEL"}}, "al": map[string]any{"name": "空想少女", "picUrl": "http://p4.music.126.net/x.jpg"}, "alia": []string{"空中散步", " "}, "tns": []string{"空中散步"}, "dt": 161000},
				{"id": 404, "name": "别的歌", "ar": []map[string]any{{"name": "B"}}, "al": map[string]any{"name": "C"}, "dt": 200000},
			}}})
		case "/search-fallback":
			write(w, map[string]any{"code": 200, "result": map[string]any{"songs": []map[string]any{
				{"id": 2, "name": "旧接口", "artists": []map[string]any{{"name": "A"}}, "album": map[string]any{"name": "专辑"}, "duration": 120000},
			}}})
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
	_, svcerr = s.GetSongURL(ctx, 12345, "")
	expectCode(t, svcerr, http.StatusNotFound, "song outside playlist")
	_, svcerr = s.GetSongURL(ctx, 3, "")
	expectCode(t, svcerr, http.StatusNotFound, "removed song")
	// 未配置音质时使用默认的 exhigh
	songURL, svcerr := s.GetSongURL(ctx, 1, "")
	if svcerr != nil || songURL != "https://m701.music.126.net/1-exhigh.mp3" {
		t.Fatalf("song url: %v %q", svcerr, songURL)
	}
	if _, svcerr = s.GetSongURL(ctx, 1, ""); svcerr != nil || calls["/song/url/v1"].Load() != 1 {
		t.Fatalf("song url should be cached: %v %d", svcerr, calls["/song/url/v1"].Load())
	}
	// 试听可要求较低音质（单独缓存）；高于后台设置或无效的音质按后台设置处理
	if songURL, svcerr = s.GetSongURL(ctx, 1, "higher"); svcerr != nil || songURL != "https://m701.music.126.net/1-higher.mp3" || calls["/song/url/v1"].Load() != 2 {
		t.Fatalf("higher song url: %v %q %d", svcerr, songURL, calls["/song/url/v1"].Load())
	}
	for _, level := range []string{"lossless", "jymaster"} {
		if songURL, svcerr = s.GetSongURL(ctx, 1, level); svcerr != nil || songURL != "https://m701.music.126.net/1-exhigh.mp3" || calls["/song/url/v1"].Load() != 2 {
			t.Fatalf("%s should not exceed the configured level: %v %q", level, svcerr, songURL)
		}
	}
	// 修改音质后不使用旧音质的缓存
	setMusicKV(t, map[string]any{"ncm_song_level": "lossless"})
	if songURL, svcerr = s.GetSongURL(ctx, 1, ""); svcerr != nil || songURL != "https://m701.music.126.net/1-lossless.mp3" || calls["/song/url/v1"].Load() != 3 {
		t.Fatalf("lossless song url: %v %q %d", svcerr, songURL, calls["/song/url/v1"].Load())
	}
	// 不在可选范围内的音质按默认音质处理
	setMusicKV(t, map[string]any{"ncm_song_level": "jymaster"})
	if songURL, svcerr = s.GetSongURL(ctx, 1, ""); svcerr != nil || songURL != "https://m701.music.126.net/1-exhigh.mp3" {
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

func TestMusicSearchSongs(t *testing.T) {
	setupEditTest(t)
	srv, calls := fakeNCMServer(t)
	s := NewMusicService()
	ctx := context.Background()
	setMusicKV(t, map[string]any{"ncm_api_base_url": srv.URL, "ncm_cookie": "abc", "ncm_playlist_id": float64(7044354223)})

	// 关键词为空或过长
	_, svcerr := s.SearchSongs(ctx, "  ")
	expectCode(t, svcerr, http.StatusBadRequest, "empty keywords")
	_, svcerr = s.SearchSongs(ctx, strings.Repeat("歌", musicSearchMaxKeywordRunes+1))
	expectCode(t, svcerr, http.StatusBadRequest, "keywords too long")

	songs, svcerr := s.SearchSongs(ctx, " 空中 ")
	if svcerr != nil || len(songs) != 2 {
		t.Fatalf("search: %v %+v", svcerr, songs)
	}
	first := songs[0]
	if first.ID != 1 || first.AlbumPic != "https://p4.music.126.net/x.jpg" || first.Duration != 161000 ||
		strings.Join(first.Artists, ",") != "CIEL" || strings.Join(first.Aliases, ",") != "空中散步" || !first.InPlaylist {
		t.Fatalf("unexpected first result: %+v", first)
	}
	if songs[1].InPlaylist {
		t.Fatalf("song outside playlist should not be marked: %+v", songs[1])
	}

	// 未配置 API 时使用网易云公开搜索（旧接口结构）
	original := musicSearchFallbackURL
	musicSearchFallbackURL = srv.URL + "/search-fallback"
	t.Cleanup(func() { musicSearchFallbackURL = original })
	setMusicKV(t, map[string]any{"ncm_api_base_url": ""})
	songs, svcerr = s.SearchSongs(ctx, "旧")
	if svcerr != nil || len(songs) != 1 || songs[0].Album != "专辑" || songs[0].Duration != 120000 || strings.Join(songs[0].Artists, ",") != "A" || calls["/search-fallback"].Load() != 1 {
		t.Fatalf("fallback search: %v %+v", svcerr, songs)
	}
}

// TestMusicLyricRevalidate 命中的网易云歌词缓存按 lyricRevalidateInterval 与上游复核：
// 平台只改了某个字的时间轴（文本不变）也算改动，摘要不同才换掉缓存；复核出错时继续用缓存
func TestMusicLyricRevalidate(t *testing.T) {
	setupEditTest(t)
	resetLyricSharedState(t)
	var body atomic.Value
	body.Store("[00:01.00]你好")
	var failing atomic.Bool
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if failing.Load() {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
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
	ctx := context.Background()

	if lyric, svcerr := s.GetLyric(ctx, 201); svcerr != nil || lyric.Lrc.Lyric != "[00:01.00]你好" {
		t.Fatalf("first = %+v, %v", lyric, svcerr)
	}
	if cached, ok := loadMusicLyricCacheEntry(201); !ok || cached.Hash == "" || cached.CheckedAt == 0 {
		t.Fatalf("cache entry should carry digest and check time: %+v", cached)
	}
	// 缓存命中：不请求上游
	before := calls.Load()
	if _, svcerr := s.GetLyric(ctx, 201); svcerr != nil {
		t.Fatal(svcerr)
	}
	if calls.Load() != before {
		t.Fatalf("fresh cache should not hit upstream, calls = %d", calls.Load()-before)
	}
	// 上游只改了时间轴，但还没到复核时间：仍是旧时间轴
	body.Store("[00:01.40]你好")
	if lyric, _ := s.GetLyric(ctx, 201); lyric.Lrc.Lyric != "[00:01.00]你好" {
		t.Fatalf("cache should be used within interval: %+v", lyric)
	}
	// 到期复核：先返回缓存里的歌词（不等上游），后台复核发现摘要不同后换成新时间轴
	seedLyricCheckedAt(t, 201, 2*lyricRevalidateInterval)
	if lyric, _ := s.GetLyric(ctx, 201); lyric.Lrc.Lyric != "[00:01.00]你好" {
		t.Fatalf("stale cache should be returned immediately: %+v", lyric)
	}
	waitLyricCondition(t, "ncm background revalidation", func() bool {
		entry, ok := loadMusicLyricCacheEntry(201)
		return ok && entry.Lyric.Lrc.Lyric == "[00:01.40]你好"
	})
	if lyric, _ := s.GetLyric(ctx, 201); lyric.Lrc.Lyric != "[00:01.40]你好" {
		t.Fatalf("revalidated = %+v", lyric)
	}
	// 普通用户「重新获取歌词」不让命中的缓存提前复核
	body.Store("[00:02.00]你好")
	before = calls.Load()
	if lyric, _ := s.GetLyric(WithLyricRefresh(ctx, "ncm", 201), 201); lyric.Lrc.Lyric != "[00:01.40]你好" || calls.Load() != before {
		t.Fatalf("plain refresh should keep the hit cache: %+v, calls = %d", lyric, calls.Load()-before)
	}
	// 管理员强制复核：立即向上游确认
	if lyric, _ := s.GetLyric(withLyricRefresh(ctx, "ncm", 201, true), 201); lyric.Lrc.Lyric != "[00:02.00]你好" {
		t.Fatalf("forced = %+v", lyric)
	}
	// 复核时上游出错：继续用缓存里的歌词，并退避，故障期间后续请求不再去问上游
	failing.Store(true)
	seedLyricCheckedAt(t, 201, 2*lyricRevalidateInterval)
	before = calls.Load()
	if lyric, svcerr := s.GetLyric(ctx, 201); svcerr != nil || lyric.Lrc.Lyric != "[00:02.00]你好" {
		t.Fatalf("error fallback = %+v, %v", lyric, svcerr)
	}
	waitLyricCondition(t, "ncm failed revalidation", func() bool { return calls.Load() > before })
	waitLyricRevalidateIdle(t)
	after := calls.Load()
	for range 3 {
		if lyric, svcerr := s.GetLyric(ctx, 201); svcerr != nil || lyric.Lrc.Lyric != "[00:02.00]你好" {
			t.Fatalf("backoff = %+v, %v", lyric, svcerr)
		}
	}
	time.Sleep(50 * time.Millisecond)
	if calls.Load() != after {
		t.Fatalf("failed revalidation should back off, extra calls = %d", calls.Load()-after)
	}
	if entry, _ := loadMusicLyricCacheEntry(201); entry.Lyric.Lrc.Lyric != "[00:02.00]你好" {
		t.Fatalf("cache should be kept on error: %+v", entry)
	}
}

// seedLyricCheckedAt 把缓存条目的核对时间往前推（模拟很久没复核）
func seedLyricCheckedAt(t *testing.T, id int64, ago time.Duration) {
	t.Helper()
	entry, ok := loadMusicLyricCacheEntry(id)
	if !ok {
		t.Fatalf("no cache entry for %d", id)
	}
	entry.CheckedAt = time.Now().Add(-ago).Unix()
	data, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}
	musicLyricCache.Put(uint(id), data, musicLyricHitTTL)
}

// jsonBytes 测试中序列化缓存条目
func jsonBytes(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// 歌单是一次上千首、1～2MB 的大响应，网易云 API 服务现拉要十几秒：它有自己的 musicPlaylistTimeout，
// 不能被普通接口的 musicRequestTimeout 卡掉，否则冷启动（重启后共享缓存没命中）会一直 ncm_request_failed，
// 播放器整页加载不出来、也就没有歌词
func TestMusicPlaylistFetchOutlivesRequestTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		_, _ = w.Write([]byte(`{"code":200,"songs":[{"id":1,"name":"歌名","ar":[{"name":"歌手"}],"al":{"name":"专辑","picUrl":"http://p1.music.126.net/a.jpg"},"alia":["别名"],"dt":1000}],"privileges":[{"id":1,"st":0}]}`))
	}))
	defer server.Close()

	original := musicRequestTimeout
	musicRequestTimeout = 100 * time.Millisecond
	t.Cleanup(func() { musicRequestTimeout = original })

	tracks, err := fetchNCMTracks(context.Background(), tools.NCMConfig{BaseURL: server.URL, Cookie: "MUSIC_U=x", PlaylistID: 1})
	if err != nil {
		t.Fatalf("playlist fetch should not be limited by musicRequestTimeout: %v", err)
	}
	if len(tracks) != 1 || tracks[0].ID != 1 || tracks[0].Name != "歌名" {
		t.Fatalf("unexpected tracks: %+v", tracks)
	}
	if musicPlaylistTimeout <= musicRequestTimeout {
		t.Fatalf("musicPlaylistTimeout %s should exceed musicRequestTimeout %s", musicPlaylistTimeout, musicRequestTimeout)
	}
}
