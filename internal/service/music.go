package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// 网易云音乐歌单：通过 NeteaseCloudMusicApi Enhanced 服务读取用户歌单、歌曲播放地址与歌词
// Cookie 只在后端使用；公开接口只提供所选歌单内的曲目，避免借站长账号播放任意歌曲

const (
	musicPlaylistTTL     = 10 * time.Minute // 歌单曲目缓存时间，过期后先返回旧数据并在后台刷新
	musicSongURLMaxTTL   = 10 * time.Minute // 播放地址最长缓存时间（地址本身有有效期）
	musicRequestTimeout  = 10 * time.Second
	musicPlaylistMaxSize = 1000
)

// musicLyricFallbackURL 未配置 API 或 API 请求失败时，直接请求网易云的歌词接口
var musicLyricFallbackURL = "https://music.163.com/api/song/lyric"

// musicSongFallbackURL 未配置 API 或 API 请求失败时，直接请求网易云的歌曲详情接口
var musicSongFallbackURL = "https://music.163.com/api/song/detail/"

// musicSearchFallbackURL 未配置 API 或 API 请求失败时使用的网易云公开搜索接口
var musicSearchFallbackURL = "https://music.163.com/api/search/get"

const (
	musicSearchMaxKeywordRunes = 50
	musicSearchLimit           = 20
)

type MusicService struct{}

func NewMusicService() *MusicService {
	return &MusicService{}
}

type musicSongURL struct {
	url       string
	level     string // 请求时的音质，修改音质后重新获取
	expiresAt time.Time
}

// musicState 歌单与播放地址缓存；配置（API、Cookie、歌单）变化后按新配置重新获取
var musicState = struct {
	sync.Mutex
	key        string
	fetchedAt  time.Time
	tracks     []dto.MusicTrackDto
	refreshing bool // 正在后台刷新歌单
	songURLs   map[int64]musicSongURL
}{}

// musicFetchMu 同一时间只向 API 获取一次歌单
var musicFetchMu sync.Mutex

// 歌词缓存：按歌曲 ID 保存序列化后的歌词
var musicLyricCache = cache.NewLRUCacheWithSize(500, 16<<20)

// 单曲信息缓存：按歌曲 ID 保存序列化后的信息（歌曲名、歌手、封面基本不变）
var musicSongCache = cache.NewLRUCacheWithSize(1000, 4<<20)

// ListNCMPlaylists 获取 Cookie 对应账号的歌单，供后台选择博客歌单
func (s *MusicService) ListNCMPlaylists(ctx context.Context, req *dto.NCMPlaylistsReq) (*dto.NCMPlaylistsDto, *errs.ServiceError) {
	cfg := tools.GetNCMConfig()
	if base := strings.TrimRight(strings.TrimSpace(req.APIBaseURL), "/"); base != "" {
		cfg.BaseURL = base
	}
	if cookie := strings.TrimSpace(req.Cookie); cookie != "" {
		cfg.Cookie = cookie
	}
	if !validMusicAPIBaseURL(cfg.BaseURL) {
		return nil, errs.NewBadRequest("ncm_invalid_api_url")
	}
	if cfg.Cookie == "" {
		return nil, errs.NewBadRequest("ncm_cookie_required")
	}

	var account struct {
		Profile *struct {
			UserID    int64  `json:"userId"`
			Nickname  string `json:"nickname"`
			AvatarURL string `json:"avatarUrl"`
		} `json:"profile"`
	}
	if err := ncmGet(ctx, cfg, "/user/account", nil, &account); err != nil {
		return nil, ncmRequestError(err)
	}
	if account.Profile == nil {
		return nil, errs.NewBadRequest("ncm_cookie_invalid")
	}

	var result struct {
		Playlist []struct {
			ID          int64  `json:"id"`
			Name        string `json:"name"`
			CoverImgURL string `json:"coverImgUrl"`
			TrackCount  int    `json:"trackCount"`
			Subscribed  bool   `json:"subscribed"`
		} `json:"playlist"`
	}
	params := url.Values{"uid": {strconv.FormatInt(account.Profile.UserID, 10)}, "limit": {strconv.Itoa(musicPlaylistMaxSize)}}
	if err := ncmGet(ctx, cfg, "/user/playlist", params, &result); err != nil {
		return nil, ncmRequestError(err)
	}
	playlists := make([]dto.NCMPlaylistDto, 0, len(result.Playlist))
	for _, p := range result.Playlist {
		playlists = append(playlists, dto.NCMPlaylistDto{
			ID:         p.ID,
			Name:       p.Name,
			Cover:      httpsURL(p.CoverImgURL),
			TrackCount: p.TrackCount,
			Subscribed: p.Subscribed,
		})
	}
	return &dto.NCMPlaylistsDto{
		Account: dto.NCMAccountDto{
			UserID:   account.Profile.UserID,
			Nickname: account.Profile.Nickname,
			Avatar:   httpsURL(account.Profile.AvatarURL),
		},
		Playlists: playlists,
	}, nil
}

// GetPlaylist 博客歌单的曲目，缓存一段时间
func (s *MusicService) GetPlaylist(ctx context.Context) ([]dto.MusicTrackDto, *errs.ServiceError) {
	cfg := tools.GetNCMConfig()
	if !cfg.Configured() {
		return nil, errs.NewNotFound("ncm_not_configured")
	}
	key := fmt.Sprintf("%s\n%s\n%d", cfg.BaseURL, cfg.Cookie, cfg.PlaylistID)

	// 已有同一配置的数据时直接返回；过期则在后台刷新，避免访客等待大歌单的获取
	if tracks, ok := cachedPlaylist(key, cfg); ok {
		return tracks, nil
	}

	// 首次获取（或配置变化）：同一时间只获取一次，等待中的请求复用结果
	musicFetchMu.Lock()
	defer musicFetchMu.Unlock()
	if tracks, ok := cachedPlaylist(key, cfg); ok {
		return tracks, nil
	}
	tracks, err := fetchNCMTracks(ctx, cfg)
	if err != nil {
		return nil, ncmRequestError(err)
	}
	storePlaylist(key, tracks)
	return tracks, nil
}

// cachedPlaylist 读取同一配置下的缓存；过期时触发一次后台刷新并先返回旧数据
func cachedPlaylist(key string, cfg tools.NCMConfig) ([]dto.MusicTrackDto, bool) {
	musicState.Lock()
	defer musicState.Unlock()
	if musicState.key != key || musicState.tracks == nil {
		return nil, false
	}
	if time.Since(musicState.fetchedAt) >= musicPlaylistTTL && !musicState.refreshing {
		musicState.refreshing = true
		go refreshPlaylist(key, cfg)
	}
	return musicState.tracks, true
}

// refreshPlaylist 后台刷新歌单；失败时保留旧数据，下次请求再重试
func refreshPlaylist(key string, cfg tools.NCMConfig) {
	musicFetchMu.Lock()
	defer musicFetchMu.Unlock()
	tracks, err := fetchNCMTracks(context.Background(), cfg)
	if err != nil {
		logrus.Warnf("ncm refresh playlist failed: %v", err)
		musicState.Lock()
		musicState.refreshing = false
		musicState.Unlock()
		return
	}
	storePlaylist(key, tracks)
}

func storePlaylist(key string, tracks []dto.MusicTrackDto) {
	musicState.Lock()
	defer musicState.Unlock()
	if musicState.key != key {
		musicState.songURLs = nil
	}
	musicState.key, musicState.fetchedAt, musicState.tracks, musicState.refreshing = key, time.Now(), tracks, false
}

// fetchNCMTracks 获取歌单全部曲目，过滤已下架的歌曲
func fetchNCMTracks(ctx context.Context, cfg tools.NCMConfig) ([]dto.MusicTrackDto, error) {
	var result struct {
		Songs []struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
			Ar   []struct {
				Name string `json:"name"`
			} `json:"ar"`
			Al struct {
				Name   string `json:"name"`
				PicURL string `json:"picUrl"`
			} `json:"al"`
			Alia []string `json:"alia"`
			Tns  []string `json:"tns"`
		} `json:"songs"`
		Privileges []struct {
			ID int64 `json:"id"`
			St int   `json:"st"` // 小于 0 表示已下架
		} `json:"privileges"`
	}
	params := url.Values{"id": {strconv.FormatInt(cfg.PlaylistID, 10)}, "limit": {strconv.Itoa(musicPlaylistMaxSize)}}
	if err := ncmGet(ctx, cfg, "/playlist/track/all", params, &result); err != nil {
		return nil, err
	}

	removed := make(map[int64]bool)
	for _, p := range result.Privileges {
		if p.St < 0 {
			removed[p.ID] = true
		}
	}
	tracks := make([]dto.MusicTrackDto, 0, len(result.Songs))
	for _, song := range result.Songs {
		if removed[song.ID] {
			continue
		}
		artists := make([]string, 0, len(song.Ar))
		for _, ar := range song.Ar {
			artists = append(artists, ar.Name)
		}
		id := strconv.FormatInt(song.ID, 10)
		tracks = append(tracks, dto.MusicTrackDto{
			ID:       song.ID,
			Name:     song.Name,
			Artists:  artists,
			Album:    song.Al.Name,
			AlbumPic: httpsURL(song.Al.PicURL),
			Audio:    constant.ApiPrefix + "/music/song/" + id + "/audio",
			Lyric:    constant.ApiPrefix + "/music/song/" + id + "/lyric",
			Link:     "https://music.163.com/#/song?id=" + id,
			Aliases:  mergeAliases(song.Alia, song.Tns),
		})
	}
	return tracks, nil
}

// GetSongURL 歌单内歌曲的临时播放地址；地址有有效期，缓存时间短于有效期
func (s *MusicService) GetSongURL(ctx context.Context, id int64) (string, *errs.ServiceError) {
	tracks, svcerr := s.GetPlaylist(ctx)
	if svcerr != nil {
		return "", svcerr
	}
	if !containsTrack(tracks, id) {
		return "", errs.NewNotFound("music_song_not_found")
	}

	cfg := tools.GetNCMConfig()
	musicState.Lock()
	cached, ok := musicState.songURLs[id]
	musicState.Unlock()
	if ok && cached.level == cfg.Level && time.Now().Before(cached.expiresAt) {
		return cached.url, nil
	}

	var result struct {
		Data []struct {
			URL  string `json:"url"`
			Expi int    `json:"expi"` // 有效期（秒）
		} `json:"data"`
	}
	// 账号没有对应音质的权限时，接口会返回可用的较低音质
	params := url.Values{"id": {strconv.FormatInt(id, 10)}, "level": {cfg.Level}}
	if err := ncmGet(ctx, cfg, "/song/url/v1", params, &result); err != nil {
		return "", ncmRequestError(err)
	}
	if len(result.Data) == 0 || result.Data[0].URL == "" {
		return "", errs.NewNotFound("music_song_unavailable")
	}
	songURL := httpsURL(result.Data[0].URL)
	if ttl := min(time.Duration(result.Data[0].Expi)*time.Second-time.Minute, musicSongURLMaxTTL); ttl > 0 {
		musicState.Lock()
		if musicState.songURLs == nil {
			musicState.songURLs = make(map[int64]musicSongURL)
		}
		musicState.songURLs[id] = musicSongURL{url: songURL, level: cfg.Level, expiresAt: time.Now().Add(ttl)}
		musicState.Unlock()
	}
	return songURL, nil
}

// GetLyric 歌曲歌词：优先使用配置的 API，失败时直接请求网易云；没有歌词时返回占位歌词
func (s *MusicService) GetLyric(ctx context.Context, id int64) (*dto.MusicLyricDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	if data, ok := musicLyricCache.Get(uint(id)); ok {
		var lyric dto.MusicLyricDto
		if json.Unmarshal(data, &lyric) == nil {
			return &lyric, nil
		}
	}

	var raw struct {
		dto.MusicLyricDto
		NoLyric bool `json:"nolyric"`
	}
	params := url.Values{"id": {strconv.FormatInt(id, 10)}}
	err := errors.New("ncm api not configured")
	// 歌词不需要登录，不携带 Cookie
	if cfg := tools.GetNCMConfig(); validMusicAPIBaseURL(cfg.BaseURL) {
		err = ncmGet(ctx, tools.NCMConfig{BaseURL: cfg.BaseURL}, "/lyric/new", params, &raw)
	}
	if err != nil {
		for _, key := range []string{"lv", "tv", "rv", "kv", "yv", "ytv"} {
			params.Set(key, "1")
		}
		params.Set("cp", "false")
		if err = musicGetJSON(ctx, musicLyricFallbackURL+"?"+params.Encode(), "", &raw); err != nil {
			return nil, ncmRequestError(err)
		}
	}

	lyric := raw.MusicLyricDto
	if lyric.Lrc == nil || strings.TrimSpace(lyric.Lrc.Lyric) == "" {
		placeholder := "[00:00.00]no_lyric"
		if raw.NoLyric {
			placeholder = "[00:00.00]pure_music_without_lyric"
		}
		lyric.Lrc = &dto.MusicLyricPart{Lyric: placeholder, Version: 1}
	}
	if data, err := json.Marshal(lyric); err == nil {
		musicLyricCache.Put(uint(id), data)
	}
	return &lyric, nil
}

// GetSong 单曲公开信息：优先使用配置的 API，失败时直接请求网易云；不携带 Cookie
func (s *MusicService) GetSong(ctx context.Context, id int64) (*dto.MusicSongDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	if data, ok := musicSongCache.Get(uint(id)); ok {
		var song dto.MusicSongDto
		if json.Unmarshal(data, &song) == nil {
			return &song, nil
		}
	}

	var raw struct {
		Songs []ncmSong `json:"songs"`
	}
	idStr := strconv.FormatInt(id, 10)
	err := errors.New("ncm api not configured")
	if cfg := tools.GetNCMConfig(); validMusicAPIBaseURL(cfg.BaseURL) {
		err = ncmGet(ctx, tools.NCMConfig{BaseURL: cfg.BaseURL}, "/song/detail", url.Values{"ids": {idStr}}, &raw)
	}
	if err != nil {
		params := url.Values{"id": {idStr}, "ids": {"[" + idStr + "]"}}
		if err = musicGetJSON(ctx, musicSongFallbackURL+"?"+params.Encode(), "", &raw); err != nil {
			return nil, ncmRequestError(err)
		}
	}
	if len(raw.Songs) == 0 || raw.Songs[0].ID != id {
		return nil, errs.NewNotFound("music_song_not_found")
	}

	item := raw.Songs[0]
	album, albumPic := item.album()
	song := dto.MusicSongDto{
		ID:       id,
		Name:     item.Name,
		Artists:  item.artistNames(),
		Album:    album,
		AlbumPic: albumPic,
		Link:     "https://music.163.com/#/song?id=" + idStr,
	}
	if data, err := json.Marshal(song); err == nil {
		musicSongCache.Put(uint(id), data)
	}
	return &song, nil
}

// SearchSongs 搜索网易云歌曲（编辑器中为单曲卡选择歌曲）：优先使用配置的 API，失败时使用网易云的公开搜索；不携带 Cookie
func (s *MusicService) SearchSongs(ctx context.Context, keywords string) ([]dto.MusicSearchSongDto, *errs.ServiceError) {
	keywords = strings.TrimSpace(keywords)
	if keywords == "" || utf8.RuneCountInString(keywords) > musicSearchMaxKeywordRunes {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}

	var raw struct {
		Result struct {
			Songs []ncmSong `json:"songs"`
		} `json:"result"`
	}
	limit := strconv.Itoa(musicSearchLimit)
	err := errors.New("ncm api not configured")
	if cfg := tools.GetNCMConfig(); validMusicAPIBaseURL(cfg.BaseURL) {
		err = ncmGet(ctx, tools.NCMConfig{BaseURL: cfg.BaseURL}, "/cloudsearch", url.Values{"keywords": {keywords}, "type": {"1"}, "limit": {limit}}, &raw)
	}
	if err != nil {
		params := url.Values{"s": {keywords}, "type": {"1"}, "limit": {limit}}
		if err = musicGetJSON(ctx, musicSearchFallbackURL+"?"+params.Encode(), "", &raw); err != nil {
			return nil, ncmRequestError(err)
		}
	}

	// 标出博客歌单内的歌曲（可在站内播放）；未配置或获取失败时不标记
	var tracks []dto.MusicTrackDto
	if tools.GetNCMConfig().Configured() {
		tracks, _ = s.GetPlaylist(ctx)
	}
	songs := make([]dto.MusicSearchSongDto, 0, len(raw.Result.Songs))
	for _, item := range raw.Result.Songs {
		album, albumPic := item.album()
		duration := item.Dt
		if duration == 0 {
			duration = item.Duration
		}
		songs = append(songs, dto.MusicSearchSongDto{
			ID:         item.ID,
			Name:       item.Name,
			Artists:    item.artistNames(),
			Album:      album,
			AlbumPic:   albumPic,
			Aliases:    mergeAliases(item.Alia, item.Tns),
			Duration:   duration,
			InPlaylist: containsTrack(tracks, item.ID),
		})
	}
	return songs, nil
}

// ncmSong 网易云歌曲：API 与新版接口为 ar / al / dt，网易云旧接口为 artists / album / duration
type ncmSong struct {
	ID       int64          `json:"id"`
	Name     string         `json:"name"`
	Ar       []ncmNamedItem `json:"ar"`
	Artists  []ncmNamedItem `json:"artists"`
	Al       *ncmAlbum      `json:"al"`
	Album    *ncmAlbum      `json:"album"`
	Alia     []string       `json:"alia"`
	Tns      []string       `json:"tns"`
	Dt       int64          `json:"dt"`       // 时长（毫秒）
	Duration int64          `json:"duration"` // 旧接口的时长（毫秒）
}

type ncmNamedItem struct {
	Name string `json:"name"`
}

type ncmAlbum struct {
	Name   string `json:"name"`
	PicURL string `json:"picUrl"`
}

func (s ncmSong) artistNames() []string {
	items := s.Ar
	if len(items) == 0 {
		items = s.Artists
	}
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, item.Name)
	}
	return names
}

func (s ncmSong) album() (name, pic string) {
	al := s.Al
	if al == nil {
		al = s.Album
	}
	if al == nil {
		return "", ""
	}
	return al.Name, httpsURL(al.PicURL)
}

// mergeAliases 合并别名（alia）与译名（tns）：两者常有相同的值，按出现顺序去重并去掉空值
func mergeAliases(lists ...[]string) []string {
	aliases := []string{}
	for _, list := range lists {
		for _, alias := range list {
			if alias = strings.TrimSpace(alias); alias != "" && !slices.Contains(aliases, alias) {
				aliases = append(aliases, alias)
			}
		}
	}
	return aliases
}

func containsTrack(tracks []dto.MusicTrackDto, id int64) bool {
	for _, track := range tracks {
		if track.ID == id {
			return true
		}
	}
	return false
}

// validMusicAPIBaseURL API 地址需为 http(s) 绝对地址
func validMusicAPIBaseURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// httpsURL 网易云返回的图片与音频地址常为 http，升级为 https，避免在 https 站点上被浏览器拦截
func httpsURL(raw string) string {
	if rest, ok := strings.CutPrefix(raw, "http://"); ok {
		return "https://" + rest
	}
	return raw
}

// ncmCookieHeader 只填写了 MUSIC_U 的值时补全键名
func ncmCookieHeader(cookie string) string {
	cookie = strings.Join(strings.Fields(cookie), " ")
	if !strings.Contains(cookie, "=") {
		return "MUSIC_U=" + cookie
	}
	return cookie
}

// ncmGet 请求 NeteaseCloudMusicApi Enhanced 接口；Cookie 通过请求头传递，避免出现在请求地址与日志中
func ncmGet(ctx context.Context, cfg tools.NCMConfig, path string, params url.Values, out any) error {
	if params == nil {
		params = url.Values{}
	}
	// 加时间戳绕过 API 服务自身的接口缓存，缓存由本服务控制
	params.Set("timestamp", strconv.FormatInt(time.Now().UnixMilli(), 10))
	cookie := ""
	if cfg.Cookie != "" {
		cookie = ncmCookieHeader(cfg.Cookie)
	}
	return musicGetJSON(ctx, cfg.BaseURL+path+"?"+params.Encode(), cookie, out)
}

// musicGetJSON 发送 GET 请求并解析响应；响应中的 code 不为 200 时视为失败
func musicGetJSON(ctx context.Context, endpoint, cookie string, out any) error {
	ctx, cancel := context.WithTimeout(ctx, musicRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	var status struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Msg     string `json:"msg"`
	}
	if err := json.Unmarshal(data, &status); err != nil {
		return fmt.Errorf("status %d: invalid response", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK || status.Code != http.StatusOK {
		return fmt.Errorf("status %d, code %d: %s%s", resp.StatusCode, status.Code, status.Message, status.Msg)
	}
	return json.Unmarshal(data, out)
}

// ncmRequestError 请求 API 失败：详情只写入日志（不含 Cookie），不返回给前端
func ncmRequestError(err error) *errs.ServiceError {
	logrus.Warnf("ncm request failed: %v", err)
	return errs.New(http.StatusBadGateway, "ncm_request_failed", err)
}
