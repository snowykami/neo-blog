package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"golang.org/x/sync/singleflight"
)

// 网易云音乐歌单：通过 NeteaseCloudMusicApi Enhanced 服务读取用户歌单、歌曲播放地址与歌词
// Cookie 只在后端使用；公开接口只提供所选歌单内的曲目，避免借站长账号播放任意歌曲

const (
	musicPlaylistTTL   = 10 * time.Minute // 歌单曲目缓存时间，过期后先返回旧数据并在后台刷新
	musicSongURLMaxTTL = 10 * time.Minute // 播放地址最长缓存时间（地址本身有有效期）
	// 共享缓存里的歌单最多保留这么久：其间新实例启动后直接使用（过期的同样先返回再在后台刷新），上游长时间不可用时也有旧数据
	musicPlaylistSharedTTL = 24 * time.Hour
	// 其他实例正在刷新歌单时，本实例这么久后再检查共享缓存里的新歌单
	musicPlaylistRecheck = 30 * time.Second
	musicPlaylistMaxSize = 1000
)

// musicRequestTimeout 普通接口（歌词、播放地址、搜索等）的请求时限；可在测试里改小
var musicRequestTimeout = 10 * time.Second

// musicPlaylistTimeout 歌单是一次上千首、1～2MB 的大响应：网易云 API 服务没有缓存时要现拉，实测十几秒到二十几秒。
// 用 musicRequestTimeout 会把首次获取（冷启动、重启后共享缓存没命中）直接判成失败，播放器整页加载不出来
const musicPlaylistTimeout = 60 * time.Second

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
	expiresAt time.Time
}

// musicSongURLKey 播放地址按歌曲与音质分别缓存（修改音质或试听用较低音质时不复用其他音质的地址）
type musicSongURLKey struct {
	id    int64
	level string
}

// musicState 歌单与播放地址缓存（本实例的 L1）；配置（API、Cookie、歌单）变化后按新配置重新获取
var musicState = struct {
	sync.Mutex
	key        string
	fetchedAt  time.Time
	tracks     []dto.MusicTrackDto
	version    string    // 歌单内容的指纹，见 playlistVersion
	refreshing bool      // 正在后台刷新歌单
	recheckAt  time.Time // 其他实例正在刷新时，到这个时间再检查共享缓存
	songURLs   map[musicSongURLKey]musicSongURL
}{}

// musicShared 歌单与播放地址的共享缓存（只在配置 Redis 时使用：各实例共用、滚动更新后仍在；单实例时 musicState 就是全部）：
// 新实例不用再向网易云获取歌单，同一首歌的播放地址各实例共用一份。键里只放配置的哈希，不放 Cookie
var musicShared = cache.NewTiered("music:ncm", 200, 32<<20)

// musicSharedPlaylist 共享缓存中的歌单
type musicSharedPlaylist struct {
	FetchedAt time.Time           `json:"fetched_at"`
	Tracks    []dto.MusicTrackDto `json:"tracks"`
	// Version 歌单内容的指纹；旧条目没有这个字段，读出后按内容补算
	Version string `json:"version"`
}

// musicSharedSongURL 共享缓存中的播放地址
type musicSharedSongURL struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

// musicConfigHash 配置（或其中一部分）的哈希，用作共享缓存的键：配置变化后自然换成新的键，键里不出现 Cookie
func musicConfigHash(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(sum[:12])
}

func musicPlaylistCacheKey(key string) string {
	return "playlist:" + musicConfigHash(key)
}

// playlistVersion 歌单内容的指纹：内容不变时不变（后端每 10 分钟重新拉一遍歌单也不会变），
// 前端缓存了歌单后用它判断要不要重新获取，比整份歌单小得多。按内容计算，各实例对同一份歌单得到同一个值
func playlistVersion(tracks []dto.MusicTrackDto) string {
	data, err := json.Marshal(tracks)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:12])
}

// musicFetchMu 同一时间只向 API 获取一次歌单
var musicFetchMu sync.Mutex

// 歌词缓存：按歌曲 ID 保存序列化后的歌词（两级缓存：配置 Redis 时各实例共用、重启后仍在，见 pkg/cache/tiered.go）
var musicLyricCache = cache.NewIDCache("music:lyric", 500, 16<<20)

// 网易云歌词缓存时长（参考 StarryPlayer）：有歌词 30 天，没有歌词 1 天（之后可能补上）；请求出错不缓存。
// 有歌词的缓存命中期间按 lyricRevalidateInterval 与上游复核（比较歌词内容摘要，见 music_lyric_refresh.go）
const (
	musicLyricHitTTL  = 30 * 24 * time.Hour
	musicLyricMissTTL = 24 * time.Hour
)

type musicLyricCacheEntry struct {
	Lyric     dto.MusicLyricDto `json:"lyric"`
	ExpiresAt int64             `json:"expires_at"`
	// 没有歌词（占位歌词）：刷新歌词时不使用
	Miss bool `json:"miss,omitempty"`
	// 命中缓存的歌词摘要与上次与上游核对一致的时间（复核时比较摘要）
	Hash      string `json:"hash,omitempty"`
	CheckedAt int64  `json:"checked_at,omitempty"`
}

// miss 是否为「没有歌词」的缓存（旧条目没有 Miss 字段，按占位歌词判断）
func (e musicLyricCacheEntry) miss() bool {
	return e.Miss || (e.Lyric.Lrc != nil && strings.HasPrefix(e.Lyric.Lrc.Lyric, "[00:00.00]no_lyric"))
}

// 单曲信息缓存：按歌曲 ID 保存序列化后的信息（歌曲名、歌手、封面基本不变）
var musicSongCache = cache.NewIDCache("music:song", 1000, 4<<20)

// musicSongTTL 单曲信息的缓存时间
const musicSongTTL = 7 * 24 * time.Hour

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
	tracks, _, svcerr := s.GetPlaylistWithVersion(ctx)
	return tracks, svcerr
}

// GetPlaylistVersion 歌单版本（内容指纹）：前端在本地有歌单时只取它，一致就不再下载整份歌单
func (s *MusicService) GetPlaylistVersion(ctx context.Context) (string, *errs.ServiceError) {
	_, version, svcerr := s.GetPlaylistWithVersion(ctx)
	return version, svcerr
}

// GetPlaylistWithVersion 歌单曲目与它的版本，一次取出（歌单与版本总是成对使用）
func (s *MusicService) GetPlaylistWithVersion(ctx context.Context) ([]dto.MusicTrackDto, string, *errs.ServiceError) {
	cfg := tools.GetNCMConfig()
	if !cfg.Configured() {
		return nil, "", errs.NewNotFound("ncm_not_configured")
	}
	key := fmt.Sprintf("%s\n%s\n%d", cfg.BaseURL, cfg.Cookie, cfg.PlaylistID)

	// 已有同一配置的数据时直接返回；过期则在后台刷新，避免访客等待大歌单的获取
	if tracks, version, ok := cachedPlaylist(key, cfg); ok {
		return tracks, version, nil
	}

	// 首次获取（或配置变化）：同一时间只获取一次，等待中的请求复用结果；多个实例同时启动时也只有一个向网易云获取，其余等它写入共享缓存
	musicFetchMu.Lock()
	defer musicFetchMu.Unlock()
	if tracks, version, ok := cachedPlaylist(key, cfg); ok {
		return tracks, version, nil
	}
	if release, err := sharedstate.Lock(ctx, "music:playlist:fetch:"+musicConfigHash(key), musicPlaylistTimeout+5*time.Second); err == nil {
		defer release()
		if tracks, version, ok := cachedPlaylist(key, cfg); ok {
			return tracks, version, nil
		}
	}
	tracks, err := fetchNCMTracks(ctx, cfg)
	if err != nil {
		return nil, "", ncmRequestError(err)
	}
	return tracks, storePlaylist(key, tracks), nil
}

// MusicPlaylistTrackMaxCandidates 恢复播放时一次最多接受的候选歌曲数
const MusicPlaylistTrackMaxCandidates = 3

// GetPlaylistTrack 页面加载恢复播放时只取一首（完整歌单约 90 KB gzip，等读者开始播放、打开歌单或切歌时前端再取）：
// 返回候选中第一首在歌单内的歌曲，都不在时返回歌单第一首，歌单为空时返回 nil。
// 只会返回博客歌单内的曲目（与 /playlist 公开的内容相同），不会借此查询任意歌曲的信息
func (s *MusicService) GetPlaylistTrack(ctx context.Context, ids []int64) (*dto.MusicTrackDto, *errs.ServiceError) {
	tracks, _, svcerr := s.GetPlaylistWithVersion(ctx)
	if svcerr != nil {
		return nil, svcerr
	}
	for _, id := range ids {
		for i := range tracks {
			if tracks[i].ID == id {
				track := tracks[i]
				return &track, nil
			}
		}
	}
	if len(tracks) == 0 {
		return nil, nil
	}
	track := tracks[0]
	return &track, nil
}

// cachedPlaylist 读取同一配置下的缓存：本实例没有时读共享缓存（其他实例或重启前获取的）；
// 过期时触发一次后台刷新并先返回旧数据
func cachedPlaylist(key string, cfg tools.NCMConfig) ([]dto.MusicTrackDto, string, bool) {
	musicState.Lock()
	missing := musicState.key != key || musicState.tracks == nil
	musicState.Unlock()
	if missing && !adoptSharedPlaylist(key, time.Time{}) {
		return nil, "", false
	}
	musicState.Lock()
	defer musicState.Unlock()
	if musicState.key != key || musicState.tracks == nil {
		return nil, "", false
	}
	if time.Since(musicState.fetchedAt) >= musicPlaylistTTL && !musicState.refreshing && time.Now().After(musicState.recheckAt) {
		musicState.refreshing = true
		go refreshPlaylist(key, cfg)
	}
	return musicState.tracks, musicState.version, true
}

// adoptSharedPlaylist 共享缓存里有比 newerThan 新的歌单时用它更新本实例的缓存，返回是否更新
func adoptSharedPlaylist(key string, newerThan time.Time) bool {
	if !sharedstate.Shared() {
		return false
	}
	shared, ok := cache.GetJSON[musicSharedPlaylist](musicShared, musicPlaylistCacheKey(key))
	if !ok || shared.Tracks == nil || !shared.FetchedAt.After(newerThan) {
		return false
	}
	// 旧条目没有版本：按内容补算，避免与版本接口给出不同的值（在加锁前算，不占着锁序列化整份歌单）
	version := shared.Version
	if version == "" {
		version = playlistVersion(shared.Tracks)
	}
	musicState.Lock()
	defer musicState.Unlock()
	if musicState.key != key {
		musicState.songURLs = nil
	}
	musicState.key, musicState.fetchedAt, musicState.tracks, musicState.version = key, shared.FetchedAt, shared.Tracks, version
	return true
}

// refreshPlaylist 后台刷新歌单：其他实例已经刷新过时直接用共享缓存里的；同一时间只有一个实例向网易云获取。
// 失败时保留旧数据，下次请求再重试
func refreshPlaylist(key string, cfg tools.NCMConfig) {
	done := func(recheck bool) {
		musicState.Lock()
		musicState.refreshing = false
		if recheck {
			musicState.recheckAt = time.Now().Add(musicPlaylistRecheck)
		}
		musicState.Unlock()
	}
	musicState.Lock()
	fetchedAt := musicState.fetchedAt
	musicState.Unlock()
	if adoptSharedPlaylist(key, fetchedAt) {
		musicState.Lock()
		fresh := time.Since(musicState.fetchedAt) < musicPlaylistTTL
		musicState.Unlock()
		if fresh {
			done(false)
			return
		}
	}
	release, ok, err := sharedstate.TryLock("music:playlist:refresh:"+musicConfigHash(key), time.Minute)
	if err == nil && !ok {
		// 其他实例正在刷新，稍后读取它的结果
		done(true)
		return
	}
	if release != nil {
		defer release()
	}
	musicFetchMu.Lock()
	defer musicFetchMu.Unlock()
	tracks, err := fetchNCMTracks(context.Background(), cfg)
	if err != nil {
		logrus.Warnf("ncm refresh playlist failed: %v", err)
		done(false)
		return
	}
	storePlaylist(key, tracks)
}

// storePlaylist 写入本实例与共享缓存，返回歌单内容的指纹
func storePlaylist(key string, tracks []dto.MusicTrackDto) string {
	now := time.Now()
	version := playlistVersion(tracks)
	musicState.Lock()
	if musicState.key != key {
		musicState.songURLs = nil
	}
	musicState.key, musicState.fetchedAt, musicState.tracks, musicState.version, musicState.refreshing = key, now, tracks, version, false
	musicState.Unlock()
	if sharedstate.Shared() {
		cache.SetJSON(musicShared, musicPlaylistCacheKey(key), musicSharedPlaylist{FetchedAt: now, Tracks: tracks, Version: version}, musicPlaylistSharedTTL)
	}
	return version
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
			Dt   int64    `json:"dt"` // 时长（毫秒）
		} `json:"songs"`
		Privileges []struct {
			ID int64 `json:"id"`
			St int   `json:"st"` // 小于 0 表示已下架
		} `json:"privileges"`
	}
	params := url.Values{"id": {strconv.FormatInt(cfg.PlaylistID, 10)}, "limit": {strconv.Itoa(musicPlaylistMaxSize)}}
	if err := ncmGetTimeout(ctx, cfg, "/playlist/track/all", params, &result, musicPlaylistTimeout); err != nil {
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
			Duration: song.Dt,
		})
	}
	return tracks, nil
}

// GetSongURL 歌单内歌曲的临时播放地址；地址有有效期，缓存时间短于有效期。
// level 为试听等场景要求的较低音质（如 higher 192k，加载更快），只能低于或等于后台设置的音质，为空或无效时用后台设置
func (s *MusicService) GetSongURL(ctx context.Context, id int64, level string) (string, *errs.ServiceError) {
	if _, svcerr := s.GetPlaylist(ctx); svcerr != nil {
		return "", svcerr
	}
	// 只对白名单内的歌曲换取播放地址（歌单、公开文章引用的歌曲、管理员与编辑，见 music_whitelist.go）
	if !s.SongPlayable(ctx, id) {
		return "", errs.NewNotFound("music_song_not_found")
	}

	cfg := tools.GetNCMConfig()
	if requested := slices.Index(tools.NCMSongLevels, level); requested >= 0 && requested < slices.Index(tools.NCMSongLevels, cfg.Level) {
		cfg.Level = level
	}
	key := musicSongURLKey{id: id, level: cfg.Level}
	musicState.Lock()
	cached, ok := musicState.songURLs[key]
	musicState.Unlock()
	if ok && time.Now().Before(cached.expiresAt) {
		return cached.url, nil
	}
	// 播放地址与账号（API、Cookie）和音质有关，与歌单无关
	sharedKey := "url:" + musicConfigHash(cfg.BaseURL, cfg.Cookie) + ":" + strconv.FormatInt(id, 10) + ":" + cfg.Level
	if shared, ok := cache.GetJSON[musicSharedSongURL](musicShared, sharedKey); ok && sharedstate.Shared() && time.Now().Before(shared.ExpiresAt) {
		storeSongURL(key, musicSongURL{url: shared.URL, expiresAt: shared.ExpiresAt})
		return shared.URL, nil
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
	// 按地址自身的有效期缓存，提前一分钟作废（播放器拿到地址后还要一段时间才开始加载）
	if ttl := min(time.Duration(result.Data[0].Expi)*time.Second-time.Minute, musicSongURLMaxTTL); ttl > 0 {
		expiresAt := time.Now().Add(ttl)
		storeSongURL(key, musicSongURL{url: songURL, expiresAt: expiresAt})
		if sharedstate.Shared() {
			cache.SetJSON(musicShared, sharedKey, musicSharedSongURL{URL: songURL, ExpiresAt: expiresAt}, ttl)
		}
	}
	return songURL, nil
}

func storeSongURL(key musicSongURLKey, value musicSongURL) {
	musicState.Lock()
	defer musicState.Unlock()
	if musicState.songURLs == nil {
		musicState.songURLs = make(map[musicSongURLKey]musicSongURL)
	}
	musicState.songURLs[key] = value
}

// GetLyric 歌曲歌词：优先使用配置的 API，失败时直接请求网易云；没有歌词时返回占位歌词
func (s *MusicService) GetLyric(ctx context.Context, id int64) (*dto.MusicLyricDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	cached, hasCached := loadMusicLyricCacheEntry(id)
	// 管理员强制复核时连有效期也不信，直接从上游重新获取
	if hasCached && !lyricForced(ctx) {
		if cached.miss() {
			// 刷新歌词时不使用「没有歌词」的缓存
			if !lyricRefreshing(ctx) {
				return &cached.Lyric, nil
			}
		} else {
			// 命中的歌词立即返回，到了复核时间就在后台与上游核对（不让读者等上游）
			if lyricCacheStale(cached.CheckedAt, cached.Hash != "") {
				revalidateLyricInBackground("ncm:"+strconv.FormatInt(id, 10), func(ctx context.Context) error {
					_, svcerr := refetchNcmLyric(ctx, id)
					if svcerr != nil {
						return svcerr
					}
					return nil
				})
			}
			return &cached.Lyric, nil
		}
	}

	// 请求合并后由多个调用方共享结果，不随第一个调用方的请求取消
	lyric, svcerr := refetchNcmLyric(context.WithoutCancel(ctx), id)
	if svcerr != nil {
		// 强制复核时上游出错：继续用缓存里的歌词，不让临时故障把歌词换掉
		if hasCached && !cached.miss() {
			return &cached.Lyric, nil
		}
		return nil, svcerr
	}
	return lyric, nil
}

// musicLyricGroup 合并同一首歌同时进行的网易云歌词请求（前台获取与后台复核共用）
var musicLyricGroup singleflight.Group

// refetchNcmLyric 向上游重新获取一首歌的歌词并写入缓存（没有歌词时写入占位歌词）；同一首歌的并发请求合并为一次
func refetchNcmLyric(ctx context.Context, id int64) (*dto.MusicLyricDto, *errs.ServiceError) {
	value, err, _ := musicLyricGroup.Do(strconv.FormatInt(id, 10), func() (any, error) {
		lyric, noLyric, svcerr := fetchNcmLyric(ctx, id)
		if svcerr != nil {
			return nil, svcerr
		}
		ttl := musicLyricHitTTL
		miss := false
		if lyric.Lrc == nil || strings.TrimSpace(lyric.Lrc.Lyric) == "" {
			placeholder := "[00:00.00]no_lyric"
			if noLyric {
				placeholder = "[00:00.00]pure_music_without_lyric"
			}
			lyric.Lrc = &dto.MusicLyricPart{Lyric: placeholder, Version: 1}
			ttl, miss = musicLyricMissTTL, true
		}
		storeMusicLyricCache(id, lyric, ttl, miss)
		return lyric, nil
	})
	if err != nil {
		var svcerr *errs.ServiceError
		if errors.As(err, &svcerr) {
			return nil, svcerr
		}
		return nil, ncmRequestError(err)
	}
	return value.(*dto.MusicLyricDto), nil
}

// loadMusicLyricCacheEntry 缓存的歌词与条目（过期或无法解析时 ok 为 false）
func loadMusicLyricCacheEntry(id int64) (musicLyricCacheEntry, bool) {
	data, found := musicLyricCache.Get(uint(id))
	if !found {
		return musicLyricCacheEntry{}, false
	}
	var entry musicLyricCacheEntry
	if json.Unmarshal(data, &entry) != nil || time.Now().Unix() >= entry.ExpiresAt {
		return musicLyricCacheEntry{}, false
	}
	return entry, true
}

// storeMusicLyricCache 写入歌词缓存：有歌词时顺便记下摘要与核对时间，共复核时比较
func storeMusicLyricCache(id int64, lyric *dto.MusicLyricDto, ttl time.Duration, miss bool) {
	entry := musicLyricCacheEntry{Lyric: *lyric, ExpiresAt: time.Now().Add(ttl).Unix(), Miss: miss}
	if !miss {
		entry.Hash = lyricContentDigest(*lyric)
		entry.CheckedAt = time.Now().Unix()
	}
	if data, err := json.Marshal(entry); err == nil {
		musicLyricCache.Put(uint(id), data, ttl)
	}
}

// fetchNcmLyric 向配置的 API（未配置时直接向网易云）要一份歌词；noLyric 为网易云标记的「纯音乐」
func fetchNcmLyric(ctx context.Context, id int64) (lyric *dto.MusicLyricDto, noLyric bool, svcerr *errs.ServiceError) {
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
			return nil, false, ncmRequestError(err)
		}
	}
	return &raw.MusicLyricDto, raw.NoLyric, nil
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
		Duration: item.duration(),
	}
	if data, err := json.Marshal(song); err == nil {
		musicSongCache.Put(uint(id), data, musicSongTTL)
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
		songs = append(songs, dto.MusicSearchSongDto{
			ID:         item.ID,
			Name:       item.Name,
			Artists:    item.artistNames(),
			Album:      album,
			AlbumPic:   albumPic,
			Aliases:    mergeAliases(item.Alia, item.Tns),
			Duration:   item.duration(),
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

// duration 时长（毫秒）：新版接口为 dt，旧接口为 duration
func (s ncmSong) duration() int64 {
	if s.Dt != 0 {
		return s.Dt
	}
	return s.Duration
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
	return ncmGetTimeout(ctx, cfg, path, params, out, musicRequestTimeout)
}

// ncmGetTimeout 同 ncmGet，超时可单独指定（歌单这类大响应见 musicPlaylistTimeout）
func ncmGetTimeout(ctx context.Context, cfg tools.NCMConfig, path string, params url.Values, out any, timeout time.Duration) error {
	if params == nil {
		params = url.Values{}
	}
	// 加时间戳绕过 API 服务自身的接口缓存，缓存由本服务控制
	params.Set("timestamp", strconv.FormatInt(time.Now().UnixMilli(), 10))
	cookie := ""
	if cfg.Cookie != "" {
		cookie = ncmCookieHeader(cfg.Cookie)
	}
	return musicGetJSONTimeout(ctx, cfg.BaseURL+path+"?"+params.Encode(), cookie, out, timeout)
}

// musicGetJSON 发送 GET 请求并解析响应；响应中的 code 不为 200 时视为失败
func musicGetJSON(ctx context.Context, endpoint, cookie string, out any) error {
	return musicGetJSONTimeout(ctx, endpoint, cookie, out, musicRequestTimeout)
}

// musicGetJSONTimeout 同 musicGetJSON，超时可单独指定
func musicGetJSONTimeout(ctx context.Context, endpoint, cookie string, out any, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
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
