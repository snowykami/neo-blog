package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"golang.org/x/sync/singleflight"
)

const (
	// MusicMVOffsetMinMs / MusicMVOffsetMaxMs 管理员可调 MV 时间轴偏移范围（毫秒）：
	// 负数延后开始（最长 60s），正数跳过 MV 片头（最长 180s）
	MusicMVOffsetMinMs = -60000
	MusicMVOffsetMaxMs = 180000

	// musicMVDefaultResolution 封面区域仅 416px 正方形，默认请求 480p 节省带宽
	musicMVDefaultResolution = "480"

	musicSongMVHitTTL    = 7 * 24 * time.Hour
	musicSongMVMissTTL   = 24 * time.Hour
	musicMVURLMaxTTL     = 15 * time.Minute
	musicMVURLDefaultTTL = 10 * time.Minute
	musicMVURLMissTTL    = 5 * time.Minute
	musicMVAllowTTL      = 24 * time.Hour
)

var (
	// musicSongMVCache 缓存 song_id -> mvid（两级缓存，多副本安全）
	musicSongMVCache = cache.NewTiered("music:song_mv", 1000, 1<<20)
	// musicMVURLCache 缓存带时效的 MV 视频直链（两级缓存，多副本安全，键中不含明文 Cookie）
	musicMVURLCache = cache.NewTiered("music:mv_url", 500, 2<<20).WithLocalTTL(2 * time.Minute)
	// musicMVAllowCache 记录公开白名单歌曲关联的 mvid，防止 /mv/:mvid/stream 被当作任意 MV 代理
	musicMVAllowCache = cache.NewTiered("music:mv_allow", 2000, 1<<20)

	musicSongMVGroup singleflight.Group
	musicMVURLGroup  singleflight.Group

	mvStreamHTTPClient = newMVStreamHTTPClient()
)

func newMVStreamHTTPClient() *http.Client {
	var transport http.RoundTripper = http.DefaultTransport
	if base, ok := http.DefaultTransport.(*http.Transport); ok {
		cloned := base.Clone()
		// 禁用自动 gzip，确保上游 Content-Length / Content-Range / 206 Partial Content 原样保留
		cloned.DisableCompression = true
		cloned.ResponseHeaderTimeout = 15 * time.Second
		transport = cloned
	}
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("stopped after 5 redirects")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return errors.New("unsupported redirect scheme")
			}
			return nil
		},
	}
}

type musicSongMVCacheEntry struct {
	MVID int64 `json:"mvid"`
}

type musicMVURLCacheEntry struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

// MVStream 后端代理的视频流响应元数据与数据流
type MVStream struct {
	StatusCode    int
	ContentType   string
	ContentLength int64
	ContentRange  string
	AcceptRanges  string
	Body          io.ReadCloser
}

func musicSongMVCacheKey(baseURL string, songID int64) string {
	return musicConfigHash(baseURL) + ":" + strconv.FormatInt(songID, 10)
}

func musicMVURLCacheKey(cfg tools.NCMConfig, mvid int64, r string) string {
	return musicConfigHash(cfg.BaseURL, cfg.Cookie) + ":" + strconv.FormatInt(mvid, 10) + ":" + r
}

func musicMVAllowCacheKey(baseURL string, mvid int64) string {
	return musicConfigHash(baseURL) + ":" + strconv.FormatInt(mvid, 10)
}

// storePlaylistSongMVID 拉取歌单时顺便预热 song_id -> mvid 与公开流白名单
func storePlaylistSongMVID(baseURL string, songID, mvid int64) {
	if songID <= 0 || mvid <= 0 || !validMusicAPIBaseURL(baseURL) {
		return
	}
	cache.SetJSON(musicSongMVCache, musicSongMVCacheKey(baseURL, songID), musicSongMVCacheEntry{MVID: mvid}, musicSongMVHitTTL)
	allowMVStream(baseURL, mvid)
}

func allowMVStream(baseURL string, mvid int64) {
	if mvid <= 0 || !validMusicAPIBaseURL(baseURL) {
		return
	}
	musicMVAllowCache.Set(musicMVAllowCacheKey(baseURL, mvid), []byte("1"), musicMVAllowTTL)
}

func (s *MusicService) isMVStreamAllowed(ctx context.Context, cfg tools.NCMConfig, mvid int64) bool {
	if user, ok := ctxutils.GetCurrentUser(ctx); ok && user.GreaterThanEditor() {
		return true
	}
	key := musicMVAllowCacheKey(cfg.BaseURL, mvid)
	if _, ok := musicMVAllowCache.Get(key); ok {
		return true
	}
	// 实例冷启动且未配 Redis 时，尝试加载一次歌单恢复歌单内曲目的 mvid 白名单
	if cfg.Configured() {
		_, _ = s.GetPlaylist(ctx)
		if _, ok := musicMVAllowCache.Get(key); ok {
			return true
		}
	}
	return false
}

// GetSongMV 查询歌曲关联的 MV 信息与同步设置（公开可读，仅对站内可播放白名单歌曲返回流地址）
func (s *MusicService) GetSongMV(ctx context.Context, id int64) (*dto.MusicSongMVDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	if !s.SongPlayable(ctx, id) {
		return nil, errs.NewNotFound("music_song_not_found")
	}

	setting, err := repo.MusicMVSetting.GetBySongID(ctx, id)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	offsetMs := 0
	disabled := false
	if setting != nil {
		offsetMs = setting.MVOffsetMs
		disabled = setting.MVDisabled
	}

	res := &dto.MusicSongMVDto{
		MVID:      0,
		Available: false,
		OffsetMs:  offsetMs,
		Disabled:  disabled,
		StreamURL: "",
	}

	cfg := tools.GetNCMConfig()
	if !validMusicAPIBaseURL(cfg.BaseURL) {
		return res, nil
	}

	mvid, err := s.resolveSongMVID(ctx, cfg, id)
	if err != nil || mvid <= 0 {
		return res, nil
	}
	res.MVID = mvid

	if s.songPublic(ctx, id) {
		allowMVStream(cfg.BaseURL, mvid)
	}

	mvURL, svcerr := s.resolveMVSourceURL(ctx, cfg, mvid, false)
	if svcerr != nil || mvURL == "" {
		return res, nil
	}

	res.Available = true
	res.StreamURL = constant.ApiPrefix + "/music/mv/" + strconv.FormatInt(mvid, 10) + "/stream"
	return res, nil
}

// SaveSongMVSetting 保存管理员调整的单曲 MV 时间轴偏移与禁用状态（仅管理员可用）
func (s *MusicService) SaveSongMVSetting(ctx context.Context, id int64, req *dto.MusicMVSettingReq) (*dto.MusicSongMVDto, *errs.ServiceError) {
	if _, ok := ctxutils.GetCurrentUser(ctx); !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	if !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	if id <= 0 || req == nil || req.OffsetMs < MusicMVOffsetMinMs || req.OffsetMs > MusicMVOffsetMaxMs {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	if _, err := repo.MusicMVSetting.Save(ctx, id, req.OffsetMs, req.Disabled); err != nil {
		logrus.Errorf("save mv setting for song %d failed: %v", id, err)
		return nil, errs.Internal("failed_to_update_target", err)
	}
	return s.GetSongMV(ctx, id)
}

// OpenMVStream 打开指定 mvid 的上游视频流并透传 Range 请求头
func (s *MusicService) OpenMVStream(ctx context.Context, mvid int64, rangeHeader string) (*MVStream, *errs.ServiceError) {
	if mvid <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	rangeHeader = strings.TrimSpace(rangeHeader)
	if rangeHeader != "" && !strings.HasPrefix(rangeHeader, "bytes=") {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}

	cfg := tools.GetNCMConfig()
	if !validMusicAPIBaseURL(cfg.BaseURL) {
		return nil, errs.NewNotFound("ncm_not_configured")
	}
	if !s.isMVStreamAllowed(ctx, cfg, mvid) {
		return nil, errs.NewNotFound("music_song_not_found")
	}

	mvURL, svcerr := s.resolveMVSourceURL(ctx, cfg, mvid, false)
	if svcerr != nil {
		return nil, svcerr
	}
	if mvURL == "" {
		return nil, errs.NewNotFound("music_song_unavailable")
	}

	resp, err := doMVStreamRequest(ctx, mvURL, rangeHeader)
	if err != nil {
		return nil, ncmRequestError(err)
	}
	// 缓存的临时直链若提前过期（403 / 410），刷新一次直链后重试
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusGone {
		_ = resp.Body.Close()
		freshURL, refreshErr := s.resolveMVSourceURL(ctx, cfg, mvid, true)
		if refreshErr != nil {
			return nil, refreshErr
		}
		if freshURL == "" {
			return nil, errs.NewNotFound("music_song_unavailable")
		}
		resp, err = doMVStreamRequest(ctx, freshURL, rangeHeader)
		if err != nil {
			return nil, ncmRequestError(err)
		}
	}

	if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
		cr := strings.TrimSpace(resp.Header.Get("Content-Range"))
		_ = resp.Body.Close()
		return &MVStream{
			StatusCode:   http.StatusRequestedRangeNotSatisfiable,
			ContentRange: cr,
			AcceptRanges: "bytes",
			Body:         http.NoBody,
		}, nil
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		status := resp.StatusCode
		_ = resp.Body.Close()
		return nil, ncmRequestError(fmt.Errorf("mv upstream status %d", status))
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if contentType == "" || strings.HasPrefix(strings.ToLower(contentType), "application/octet-stream") {
		contentType = "video/mp4"
	}
	acceptRanges := strings.TrimSpace(resp.Header.Get("Accept-Ranges"))
	if acceptRanges == "" {
		acceptRanges = "bytes"
	}

	return &MVStream{
		StatusCode:    resp.StatusCode,
		ContentType:   contentType,
		ContentLength: resp.ContentLength,
		ContentRange:  strings.TrimSpace(resp.Header.Get("Content-Range")),
		AcceptRanges:  acceptRanges,
		Body:          resp.Body,
	}, nil
}

func doMVStreamRequest(ctx context.Context, targetURL, rangeHeader string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Referer", "https://music.163.com/")
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	return mvStreamHTTPClient.Do(req)
}

func (s *MusicService) resolveSongMVID(ctx context.Context, cfg tools.NCMConfig, songID int64) (int64, error) {
	cacheKey := musicSongMVCacheKey(cfg.BaseURL, songID)
	if cached, ok := cache.GetJSON[musicSongMVCacheEntry](musicSongMVCache, cacheKey); ok {
		return cached.MVID, nil
	}

	val, err, _ := musicSongMVGroup.Do(cacheKey, func() (any, error) {
		if cached, ok := cache.GetJSON[musicSongMVCacheEntry](musicSongMVCache, cacheKey); ok {
			return cached.MVID, nil
		}
		var raw struct {
			Songs []ncmSong `json:"songs"`
		}
		idStr := strconv.FormatInt(songID, 10)
		// /song/detail 属于公开歌曲元信息，与 GetSong 一致不携带 Cookie
		reqErr := ncmGet(context.WithoutCancel(ctx), tools.NCMConfig{BaseURL: cfg.BaseURL}, "/song/detail", url.Values{"ids": {idStr}}, &raw)
		if reqErr != nil {
			params := url.Values{"id": {idStr}, "ids": {"[" + idStr + "]"}}
			reqErr = musicGetJSON(context.WithoutCancel(ctx), musicSongFallbackURL+"?"+params.Encode(), "", &raw)
		}
		if reqErr != nil {
			return int64(0), reqErr
		}
		var mvid int64
		if len(raw.Songs) > 0 && raw.Songs[0].ID == songID {
			mvid = raw.Songs[0].mvID()
		}
		ttl := musicSongMVMissTTL
		if mvid > 0 {
			ttl = musicSongMVHitTTL
		}
		cache.SetJSON(musicSongMVCache, cacheKey, musicSongMVCacheEntry{MVID: mvid}, ttl)
		return mvid, nil
	})
	if err != nil {
		return 0, err
	}
	return val.(int64), nil
}

func (s *MusicService) resolveMVSourceURL(ctx context.Context, cfg tools.NCMConfig, mvid int64, forceRefresh bool) (string, *errs.ServiceError) {
	cacheKey := musicMVURLCacheKey(cfg, mvid, musicMVDefaultResolution)
	if !forceRefresh {
		if cached, ok := cache.GetJSON[musicMVURLCacheEntry](musicMVURLCache, cacheKey); ok && time.Now().Before(cached.ExpiresAt) {
			return cached.URL, nil
		}
	} else {
		musicMVURLCache.Delete(cacheKey)
	}

	val, err, _ := musicMVURLGroup.Do(cacheKey, func() (any, error) {
		if !forceRefresh {
			if cached, ok := cache.GetJSON[musicMVURLCacheEntry](musicMVURLCache, cacheKey); ok && time.Now().Before(cached.ExpiresAt) {
				return cached.URL, nil
			}
		}
		var result struct {
			Data struct {
				URL  string `json:"url"`
				Expi int    `json:"expi"`
			} `json:"data"`
		}
		params := url.Values{
			"id": {strconv.FormatInt(mvid, 10)},
			"r":  {musicMVDefaultResolution},
		}
		if reqErr := ncmGet(context.WithoutCancel(ctx), cfg, "/mv/url", params, &result); reqErr != nil {
			return "", reqErr
		}
		mvURL := strings.TrimSpace(result.Data.URL)
		if mvURL != "" && !validMusicAPIBaseURL(mvURL) {
			mvURL = ""
		}
		ttl := computeMVURLCacheTTL(mvURL, result.Data.Expi)
		if ttl > 0 {
			cache.SetJSON(musicMVURLCache, cacheKey, musicMVURLCacheEntry{
				URL:       mvURL,
				ExpiresAt: time.Now().Add(ttl),
			}, ttl)
		}
		return mvURL, nil
	})
	if err != nil {
		return "", ncmRequestError(err)
	}
	return val.(string), nil
}

func computeMVURLCacheTTL(mvURL string, expiSeconds int) time.Duration {
	if mvURL == "" {
		return musicMVURLMissTTL
	}
	if expiSeconds <= 0 {
		return musicMVURLDefaultTTL
	}
	raw := time.Duration(expiSeconds) * time.Second
	if raw > 2*time.Minute {
		return min(raw-time.Minute, musicMVURLMaxTTL)
	}
	return min(max(raw/2, 15*time.Second), musicMVURLMaxTTL)
}
