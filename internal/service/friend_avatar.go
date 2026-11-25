package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
	"golang.org/x/image/bmp"
	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/webp"
	"golang.org/x/sync/singleflight"
	"gorm.io/gorm"
)

const (
	// 友链卡片头像展示尺寸为 44×44 CSS px，按 96×96（>2x Retina）裁剪压缩，单张一般仅 2~10 KiB
	friendAvatarThumbSize           = 96
	friendAvatarJPEGQuality         = 82
	friendAvatarMaxFetchBytes       = 5 << 20  // 上游原图最大拉取 5 MiB（同时作用于压缩流与解压流）
	friendAvatarMaxCachedBytes      = 64 << 10 // 写入 Redis 的缩略图体积硬上限 64 KiB
	friendAvatarMaxSmallGIFBytes    = 48 << 10 // 小尺寸且帧数受限的 GIF（含动图）直通缓存上限
	friendAvatarMaxGIFFrames        = 40       // 保留动图的最多帧数，超出则仅取首帧静态缩放
	friendAvatarMaxAVIFBytes        = 48 << 10 // 校验通过 ispe 尺寸的 AVIF 直通上限
	friendAvatarMaxAVIFDimension    = 512      // 直通 AVIF 的最大宽高
	friendAvatarMaxDimension        = 4096     // 防解压炸弹：单边最大 4096px
	friendAvatarMaxTotalPixels      = 16_000_000
	friendAvatarMaxConcurrentDecode = 4 // 全局完整图像解码并发度，限制峰值内存
	friendAvatarFetchTimeout        = 10 * time.Second
	friendAvatarCacheTTL            = 7 * 24 * time.Hour
	friendAvatarPreviewCacheTTL     = 15 * time.Minute // 未审核通过友链仅短期缓存，防写爆 Redis
	friendAvatarNegativeCacheTTL    = 5 * time.Minute
	friendAvatarRedisKeyPrefix      = "friend_avatar:v2:"
	friendAvatarCacheRecordOKPrefix = "OK\n"
	friendAvatarCacheRecordErrPref  = "ERR\n"
)

var (
	errFriendAvatarUnavailable = errors.New("friend avatar unavailable")
	errFriendAvatarUnsupported = errors.New("unsupported friend avatar format")
	errFriendAvatarTooLarge    = errors.New("friend avatar exceeds size limit")

	friendAvatarSingleflight singleflight.Group
	friendAvatarDecodeSem    = make(chan struct{}, friendAvatarMaxConcurrentDecode)

	// 友链出站专用安全传输层：严格仅允许 80/443 公网 IP（禁止任意端口扫描与 Fake-IP 内网保留段）
	friendOutboundSafeDialOpts = utils.SafeDialOptions{
		DialTimeout:  linkPreviewDialTimeout,
		AllowAnyPort: false,
		AllowPrivate: func() bool { return linkPreviewAllowPrivate },
		AllowAddr:    utils.IsPublicAddr,
		LookupNetIP: func(ctx context.Context, host string) ([]netip.Addr, error) {
			return linkPreviewLookupNetIP(ctx, host)
		},
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			return linkPreviewDial(ctx, network, address)
		},
	}

	friendOutboundTransport = utils.NewSafeTransport(utils.SafeTransportOptions{
		SafeDialOptions:       friendOutboundSafeDialOpts,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 8 * time.Second,
		MaxIdleConns:          32,
		MaxIdleConnsPerHost:   4,
		IdleConnTimeout:       30 * time.Second,
	})

	friendOutboundRoundTripper http.RoundTripper = friendOutboundTransport
)

// FriendAvatarResult 后端处理并缓存后的友链头像输出
type FriendAvatarResult struct {
	ContentType   string
	Data          []byte
	ETag          string
	IsPublicCache bool // 仅已审核通过且所在分组公开时允许标记为 public 缓存
	ViaAPIToken   bool // 是否经由 API Token 读取（用于补充跨域头）
	Unavailable   bool // 上游外链头像不可达或格式不受支持
	RedirectURL   string
}

type friendAvatarFetched struct {
	contentType string
	data        []byte
	etag        string
}

// NormalizeFriendOutboundURL 校验并规范化友链相关的外部 HTTP(S) URL：严格限制纯公网地址与标准 80/443 端口，并拦截本站头像缓存自环
func NormalizeFriendOutboundURL(raw string) (string, *url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || len(trimmed) > 512 {
		return "", nil, errLinkPreviewBlockedAddr
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return "", nil, errLinkPreviewBlockedAddr
	}
	allowPriv := linkPreviewAllowPrivate || utils.SafeFetchAllowPrivate
	if err := utils.CheckSafeURL(u, allowPriv, utils.IsPublicAddr); err != nil {
		return "", nil, errLinkPreviewBlockedAddr
	}

	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	port := u.Port()
	if !allowPriv && port != "" && port != "80" && port != "443" {
		return "", nil, errLinkPreviewBlockedAddr
	}
	if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		port = ""
	}
	u.Scheme = scheme
	if port != "" {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	} else {
		u.Host = host
	}
	if u.Path == "" {
		u.Path = "/"
		u.RawPath = ""
	}

	// 阻断指向本站 /api/v1/friends/avatar/ 的自指递归放大（含路径点段规整与 www. 前缀归一）
	cleanPath := path.Clean(strings.ToLower(u.Path))
	if strings.HasPrefix(cleanPath, "/api/v1/friends/avatar") {
		if base := tools.GetBaseUrl(); base != "" {
			if bu, bErr := url.Parse(base); bErr == nil {
				baseHost := strings.TrimPrefix(strings.ToLower(bu.Hostname()), "www.")
				reqHost := strings.TrimPrefix(host, "www.")
				if baseHost != "" && baseHost == reqHost {
					return "", nil, errLinkPreviewBlockedAddr
				}
			}
		}
	}

	normalized := uppercasePercentEncoding(u.String())
	parsedNorm, err := url.Parse(normalized)
	if err != nil {
		return "", nil, errLinkPreviewBlockedAddr
	}
	return normalized, parsedNorm, nil
}

func friendAvatarCacheKey(normalizedAvatarURL string) string {
	sum := sha256.Sum256([]byte(normalizedAvatarURL))
	return friendAvatarRedisKeyPrefix + hex.EncodeToString(sum[:])
}

// EvictFriendAvatarCache 在友链删除、驳回或更换头像时主动清理缓存中的旧头像
func EvictFriendAvatarCache(rawAvatar string) {
	normStr, _, err := NormalizeFriendOutboundURL(rawAvatar)
	if err != nil {
		return
	}
	_ = sharedstate.Current().Delete(friendAvatarCacheKey(normStr))
}

func encodeAvatarCacheValue(contentType, etag string, data []byte) string {
	var b strings.Builder
	b.Grow(len(friendAvatarCacheRecordOKPrefix) + len(contentType) + 1 + len(etag) + 1 + len(data))
	b.WriteString(friendAvatarCacheRecordOKPrefix)
	b.WriteString(contentType)
	b.WriteByte('\n')
	b.WriteString(etag)
	b.WriteByte('\n')
	b.Write(data)
	return b.String()
}

func decodeAvatarCacheValue(raw string) (okRecord bool, contentType, etag string, data []byte, failed bool) {
	if strings.HasPrefix(raw, friendAvatarCacheRecordErrPref) {
		return false, "", "", nil, true
	}
	if !strings.HasPrefix(raw, friendAvatarCacheRecordOKPrefix) {
		return false, "", "", nil, false
	}
	rest := raw[len(friendAvatarCacheRecordOKPrefix):]
	parts := strings.SplitN(rest, "\n", 3)
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || len(parts[2]) == 0 {
		return false, "", "", nil, false
	}
	return true, parts[0], parts[1], []byte(parts[2]), false
}

// isValidFriendAvatarHash 严格要求精确 16 位小写十六进制指纹，阻断大小写混合排列导致的 CDN 缓存放大
func isValidFriendAvatarHash(s string) bool {
	if len(s) != 16 {
		return false
	}
	for i := 0; i < 16; i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// GetFriendAvatarThumbnail 按友链 ID 读取或拉取压缩后的小图（严格最小权限，不透传原始 SVG，失效统一返回 404 不污染 5xx 告警）
func (s *FriendService) GetFriendAvatarThumbnail(ctx context.Context, id uint, reqHash string) (*FriendAvatarResult, *errs.ServiceError) {
	if id == 0 || !isValidFriendAvatarHash(reqHash) {
		return nil, errs.NewNotFound("target_not_found").WithResource("friend_avatar")
	}

	link, err := repo.Friend.GetLink(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("friend_avatar")
		}
		return nil, errs.Internal("failed_to_get_target", err).WithResource("friend_avatar")
	}

	grp, err := repo.Friend.GetGroup(link.GroupID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("friend_group")
	}

	_, viaToken := ctxutils.GetAPIToken(ctx)
	publiclyVisible := link.Status == model.FriendStatusApproved && grp != nil && grp.IsPublic
	if !publiclyVisible {
		var isPrivileged bool
		if viaToken {
			// API Token 严格按被授予的 Scope 鉴权：friends:read 仅能读取已审核通过的友链（含私密分组），friends:write 管理员 Token 可读全部
			isPrivileged = (link.Status == model.FriendStatusApproved && ctxutils.HasAPITokenScope(ctx, constant.ScopeFriendsRead)) ||
				(ctxutils.HasAPITokenScope(ctx, constant.ScopeFriendsWrite) && ctxutils.IsAdmin(ctx))
		} else {
			isPrivileged = ctxutils.IsAdmin(ctx) ||
				(link.OwnerUserID() != 0 && ctxutils.IsOwnerOfTarget(ctx, link.OwnerUserID()))
		}
		if !isPrivileged {
			return nil, errs.NewNotFound("target_not_found").WithResource("friend_avatar")
		}
	}

	trimmedAvatar := strings.TrimSpace(link.Avatar)
	if trimmedAvatar == "" {
		return nil, errs.NewNotFound("target_not_found").WithResource("friend_avatar")
	}
	if model.IsSafeInternalAvatarPath(trimmedAvatar) {
		return &FriendAvatarResult{
			RedirectURL:   trimmedAvatar,
			IsPublicCache: publiclyVisible,
			ViaAPIToken:   viaToken,
		}, nil
	}
	if strings.HasPrefix(trimmedAvatar, "/") {
		return nil, errs.NewNotFound("target_not_found").WithResource("friend_avatar")
	}

	expectedHash := model.FriendAvatarHash(trimmedAvatar)
	if reqHash != expectedHash {
		// 路径指纹与当前头像不一致（如刚更新头像期间命中旧页面缓存）时 302 跳转至最新规范地址，不在旧路径下写入可缓存内容
		canonical := link.AvatarCacheURL()
		if canonical == "" {
			return nil, errs.NewNotFound("target_not_found").WithResource("friend_avatar")
		}
		return &FriendAvatarResult{
			RedirectURL:   canonical,
			IsPublicCache: false,
			ViaAPIToken:   viaToken,
		}, nil
	}

	ttl := friendAvatarPreviewCacheTTL
	if link.Status == model.FriendStatusApproved {
		ttl = friendAvatarCacheTTL
	}

	fetched, fetchErr := getOrFetchFriendAvatar(ctx, trimmedAvatar, ttl)
	if fetchErr != nil {
		return &FriendAvatarResult{
			Unavailable:   true,
			IsPublicCache: publiclyVisible,
			ViaAPIToken:   viaToken,
		}, nil
	}

	return &FriendAvatarResult{
		ContentType:   fetched.contentType,
		Data:          fetched.data,
		ETag:          fetched.etag,
		IsPublicCache: publiclyVisible,
		ViaAPIToken:   viaToken,
	}, nil
}

// WarmFriendAvatarCache 后台预热已公开友链的头像缩略图到 Redis（遵从 ctx 超时取消，已缓存时零网络开销跳过）
func WarmFriendAvatarCache(ctx context.Context, rawAvatar string) {
	if ctx.Err() != nil {
		return
	}
	trimmed := strings.TrimSpace(rawAvatar)
	if trimmed == "" || strings.HasPrefix(trimmed, "/") {
		return
	}
	if u, err := url.Parse(trimmed); err == nil && strings.HasSuffix(strings.ToLower(u.Path), ".svg") {
		return
	}
	_, _ = getOrFetchFriendAvatar(ctx, trimmed, friendAvatarCacheTTL)
}

func getOrFetchFriendAvatar(ctx context.Context, rawAvatar string, cacheTTL time.Duration) (friendAvatarFetched, error) {
	normStr, parsedURL, normErr := NormalizeFriendOutboundURL(rawAvatar)
	if normErr != nil || parsedURL == nil {
		return friendAvatarFetched{}, errFriendAvatarUnavailable
	}

	cacheKey := friendAvatarCacheKey(normStr)
	if val, ok, getErr := sharedstate.Current().Get(cacheKey); getErr == nil && ok {
		okRec, ct, tag, body, failed := decodeAvatarCacheValue(val)
		if okRec {
			return friendAvatarFetched{contentType: ct, data: body, etag: tag}, nil
		}
		if failed {
			return friendAvatarFetched{}, errFriendAvatarUnavailable
		}
	}

	if ctx.Err() != nil {
		return friendAvatarFetched{}, ctx.Err()
	}

	ch := friendAvatarSingleflight.DoChan("avatar:"+cacheKey, func() (any, error) {
		if val, ok, getErr := sharedstate.Current().Get(cacheKey); getErr == nil && ok {
			okRec, ct, tag, body, failed := decodeAvatarCacheValue(val)
			if okRec {
				return friendAvatarFetched{contentType: ct, data: body, etag: tag}, nil
			}
			if failed {
				return friendAvatarFetched{}, errFriendAvatarUnavailable
			}
		}

		fetchCtx, cancel := context.WithTimeout(context.Background(), friendAvatarFetchTimeout)
		defer cancel()

		rawBytes, fetchErr := fetchUpstreamAvatarBytes(fetchCtx, parsedURL.String())
		if fetchErr != nil {
			_ = sharedstate.Current().Set(cacheKey, friendAvatarCacheRecordErrPref+"fetch", friendAvatarNegativeCacheTTL)
			return friendAvatarFetched{}, fetchErr
		}

		thumbBytes, thumbCT, procErr := buildFriendAvatarThumbnailWithLimit(fetchCtx, rawBytes)
		if procErr != nil || len(thumbBytes) == 0 || len(thumbBytes) > friendAvatarMaxCachedBytes {
			_ = sharedstate.Current().Set(cacheKey, friendAvatarCacheRecordErrPref+"decode", friendAvatarNegativeCacheTTL)
			if procErr != nil {
				return friendAvatarFetched{}, procErr
			}
			return friendAvatarFetched{}, errFriendAvatarTooLarge
		}

		sum := sha256.Sum256(thumbBytes)
		tag := fmt.Sprintf("\"%x\"", sum[:12])
		encoded := encodeAvatarCacheValue(thumbCT, tag, thumbBytes)
		if setErr := sharedstate.Current().Set(cacheKey, encoded, cacheTTL); setErr != nil {
			logrus.Warnf("cache friend avatar in sharedstate failed: %v", setErr)
		}
		return friendAvatarFetched{contentType: thumbCT, data: thumbBytes, etag: tag}, nil
	})

	select {
	case res := <-ch:
		if res.Err != nil {
			return friendAvatarFetched{}, res.Err
		}
		return res.Val.(friendAvatarFetched), nil
	case <-ctx.Done():
		return friendAvatarFetched{}, ctx.Err()
	}
}

func fetchUpstreamAvatarBytes(ctx context.Context, rawURL string) ([]byte, error) {
	_, current, err := NormalizeFriendOutboundURL(rawURL)
	if err != nil || current == nil {
		return nil, errFriendAvatarUnavailable
	}

	for hop := 0; hop <= linkPreviewMaxRedirects; hop++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, current.String(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", linkPreviewUserAgent)
		req.Header.Set("Accept", "image/webp,image/png,image/jpeg,image/gif,image/x-icon,image/*;q=0.8,*/*;q=0.5")
		req.Header.Set("Accept-Encoding", "gzip, deflate")

		resp, err := friendOutboundRoundTripper.RoundTrip(req)
		if err != nil {
			return nil, err
		}

		status := resp.StatusCode
		if status == http.StatusMovedPermanently || status == http.StatusFound || status == http.StatusSeeOther ||
			status == http.StatusTemporaryRedirect || status == http.StatusPermanentRedirect {
			loc := resp.Header.Get("Location")
			_ = resp.Body.Close()
			if loc == "" {
				return nil, errFriendAvatarUnavailable
			}
			nextRaw, err := current.Parse(loc)
			if err != nil {
				return nil, err
			}
			_, nextNorm, err := NormalizeFriendOutboundURL(nextRaw.String())
			if err != nil {
				return nil, err
			}
			current = nextNorm
			continue
		}

		if status < 200 || status >= 300 {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("upstream avatar status %d", status)
		}
		if resp.ContentLength > friendAvatarMaxFetchBytes {
			_ = resp.Body.Close()
			return nil, errFriendAvatarTooLarge
		}

		body, readErr := readBoundedAvatarStream(resp.Body, resp.Header.Get("Content-Encoding"), friendAvatarMaxFetchBytes)
		_ = resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		return body, nil
	}
	return nil, errors.New("too many redirects")
}

func readBoundedAvatarStream(raw io.Reader, contentEncoding string, maxBytes int) ([]byte, error) {
	// 同时限制底层压缩流与上层解压流的字节上限，阻断零输出 deflate 块刷流消耗 CPU
	boundedRaw := io.LimitReader(raw, int64(maxBytes)+1)
	reader, cleanup, err := wrapDecompressReader(boundedRaw, contentEncoding)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	limited := io.LimitReader(reader, int64(maxBytes)+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, errFriendAvatarUnavailable
	}
	if len(data) > maxBytes {
		return nil, errFriendAvatarTooLarge
	}
	return data, nil
}

func buildFriendAvatarThumbnailWithLimit(ctx context.Context, raw []byte) ([]byte, string, error) {
	select {
	case friendAvatarDecodeSem <- struct{}{}:
		defer func() { <-friendAvatarDecodeSem }()
		return buildFriendAvatarThumbnail(raw)
	case <-ctx.Done():
		return nil, "", ctx.Err()
	}
}

// buildFriendAvatarThumbnail 严格校验魔数、重编码剥离元数据与潜在载荷，并按展示尺寸（96×96）裁剪压缩（绝不直通 SVG 或未经解码的未知字节）
func buildFriendAvatarThumbnail(raw []byte) ([]byte, string, error) {
	if len(raw) < 4 {
		return nil, "", errFriendAvatarUnsupported
	}

	// 1. PNG：始终完整解码重编码，消除 zTXt 体积膨胀与多态尾部载荷
	if len(raw) >= 8 && string(raw[:8]) == "\x89PNG\r\n\x1a\n" {
		cfg, err := png.DecodeConfig(bytes.NewReader(raw))
		if err != nil || !validAvatarDimensions(cfg.Width, cfg.Height) {
			return nil, "", errFriendAvatarUnsupported
		}
		img, err := png.Decode(bytes.NewReader(raw))
		if err != nil {
			return nil, "", err
		}
		return encodeThumbnailImage(img)
	}

	// 2. JPEG：始终完整解码重编码，自动剥离 EXIF 隐私元数据
	if len(raw) >= 3 && raw[0] == 0xff && raw[1] == 0xd8 && raw[2] == 0xff {
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(raw))
		if err != nil || !validAvatarDimensions(cfg.Width, cfg.Height) {
			return nil, "", errFriendAvatarUnsupported
		}
		img, err := jpeg.Decode(bytes.NewReader(raw))
		if err != nil {
			return nil, "", err
		}
		return encodeThumbnailImage(img)
	}

	// 3. GIF：仅当全部子帧校验合法且小巧时保留原动图，否则取首帧静态缩放
	if len(raw) >= 6 && (string(raw[:6]) == "GIF87a" || string(raw[:6]) == "GIF89a") {
		cfg, err := gif.DecodeConfig(bytes.NewReader(raw))
		if err != nil || !validAvatarDimensions(cfg.Width, cfg.Height) {
			return nil, "", errFriendAvatarUnsupported
		}
		if cfg.Width <= friendAvatarThumbSize && cfg.Height <= friendAvatarThumbSize && len(raw) <= friendAvatarMaxSmallGIFBytes {
			if g, allErr := gif.DecodeAll(bytes.NewReader(raw)); allErr == nil && len(g.Image) > 1 && len(g.Image) <= friendAvatarMaxGIFFrames {
				allValid := true
				for _, frame := range g.Image {
					fb := frame.Bounds()
					if fb.Dx() <= 0 || fb.Dy() <= 0 || fb.Max.X > friendAvatarThumbSize || fb.Max.Y > friendAvatarThumbSize || fb.Min.X < 0 || fb.Min.Y < 0 {
						allValid = false
						break
					}
				}
				if allValid {
					return raw, "image/gif", nil
				}
			}
		}
		img, err := gif.Decode(bytes.NewReader(raw))
		if err != nil {
			return nil, "", err
		}
		return encodeThumbnailImage(img)
	}

	// 4. WebP：始终经 webp.Decode 完整解码，阻断 VP8X 画布尺寸欺骗绕过
	if len(raw) >= 12 && string(raw[0:4]) == "RIFF" && string(raw[8:12]) == "WEBP" {
		cfg, err := webp.DecodeConfig(bytes.NewReader(raw))
		if err != nil || !validAvatarDimensions(cfg.Width, cfg.Height) {
			return nil, "", errFriendAvatarUnsupported
		}
		img, err := webp.Decode(bytes.NewReader(raw))
		if err != nil {
			return nil, "", err
		}
		return encodeThumbnailImage(img)
	}

	// 5. BMP
	if len(raw) >= 2 && raw[0] == 'B' && raw[1] == 'M' {
		cfg, err := bmp.DecodeConfig(bytes.NewReader(raw))
		if err != nil || !validAvatarDimensions(cfg.Width, cfg.Height) {
			return nil, "", errFriendAvatarUnsupported
		}
		img, err := bmp.Decode(bytes.NewReader(raw))
		if err != nil {
			return nil, "", err
		}
		return encodeThumbnailImage(img)
	}

	// 6. ICO：解析内嵌 PNG 或 1/4/8/24/32 位 DIB 并统一重编码为标准 PNG/JPEG，不直通原始字节
	if len(raw) >= 6 && raw[0] == 0 && raw[1] == 0 && raw[2] == 1 && raw[3] == 0 {
		return processICOAvatar(raw)
	}

	// 7. 小型合规 AVIF（严格解析校验 ISO BMFF ispe 尺寸盒后受限放行）
	if isFriendAvifWithSafeISPE(raw) {
		return raw, "image/avif", nil
	}

	return nil, "", errFriendAvatarUnsupported
}

func validAvatarDimensions(w, h int) bool {
	return w > 0 && h > 0 && w <= friendAvatarMaxDimension && h <= friendAvatarMaxDimension && w*h <= friendAvatarMaxTotalPixels
}

func encodeThumbnailImage(src image.Image) ([]byte, string, error) {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if !validAvatarDimensions(w, h) {
		return nil, "", errFriendAvatarUnsupported
	}

	// 居中正方形裁剪，与前端 ImageAvatar 的 aspect-square + object-cover 视觉构图严格一致
	side := min(w, h)
	cropX := b.Min.X + (w-side)/2
	cropY := b.Min.Y + (h-side)/2
	cropRect := image.Rect(cropX, cropY, cropX+side, cropY+side)

	dstSide := min(side, friendAvatarThumbSize)
	// 使用 *image.RGBA 命中 golang.org/x/image/draw 的底层切片快速路径，避免百万级接口调用
	dst := image.NewRGBA(image.Rect(0, 0, dstSide, dstSide))
	if dstSide == side && w == h {
		draw.Draw(dst, dst.Bounds(), src, cropRect.Min, draw.Src)
	} else {
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, cropRect, xdraw.Src, nil)
	}

	hasAlpha := false
	for i := 3; i < len(dst.Pix); i += 4 {
		if dst.Pix[i] < 0xff {
			hasAlpha = true
			break
		}
	}

	var out bytes.Buffer
	if !hasAlpha {
		if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: friendAvatarJPEGQuality}); err != nil {
			return nil, "", err
		}
		return out.Bytes(), "image/jpeg", nil
	}

	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(&out, dst); err != nil {
		return nil, "", err
	}
	return out.Bytes(), "image/png", nil
}

type icoFrameCandidate struct {
	width  int
	height int
	bpp    uint16
	data   []byte
	isPNG  bool
}

func processICOAvatar(raw []byte) ([]byte, string, error) {
	count := int(binary.LittleEndian.Uint16(raw[4:6]))
	if count <= 0 {
		return nil, "", errFriendAvatarUnsupported
	}
	if count > 32 {
		count = 32
	}
	dirEnd := 6 + count*16
	if len(raw) < dirEnd {
		return nil, "", errFriendAvatarUnsupported
	}

	candidates := make([]icoFrameCandidate, 0, count)
	for i := 0; i < count; i++ {
		off := 6 + i*16
		w := int(raw[off])
		if w == 0 {
			w = 256
		}
		h := int(raw[off+1])
		if h == 0 {
			h = 256
		}
		bpp := binary.LittleEndian.Uint16(raw[off+6 : off+8])
		size := int(binary.LittleEndian.Uint32(raw[off+8 : off+12]))
		dataOff := int(binary.LittleEndian.Uint32(raw[off+12 : off+16]))
		if size <= 0 || dataOff < dirEnd || dataOff > len(raw) || size > len(raw)-dataOff {
			continue
		}
		sub := raw[dataOff : dataOff+size]
		isPNG := len(sub) >= 8 && string(sub[:8]) == "\x89PNG\r\n\x1a\n"
		candidates = append(candidates, icoFrameCandidate{
			width:  w,
			height: h,
			bpp:    bpp,
			data:   sub,
			isPNG:  isPNG,
		})
	}
	if len(candidates) == 0 {
		return nil, "", errFriendAvatarUnsupported
	}

	slices.SortFunc(candidates, func(a, b icoFrameCandidate) int {
		aSide, bSide := min(a.width, a.height), min(b.width, b.height)
		aGe := aSide >= friendAvatarThumbSize
		bGe := bSide >= friendAvatarThumbSize
		if aGe != bGe {
			if aGe {
				return -1
			}
			return 1
		}
		if aGe {
			if aSide != bSide {
				return aSide - bSide
			}
		} else if aSide != bSide {
			return bSide - aSide
		}
		if a.isPNG != b.isPNG {
			if a.isPNG {
				return -1
			}
			return 1
		}
		return int(b.bpp) - int(a.bpp)
	})

	for _, cand := range candidates {
		if cand.isPNG {
			cfg, err := png.DecodeConfig(bytes.NewReader(cand.data))
			if err != nil {
				continue
			}
			// 一旦发现内嵌超限解压炸弹立即拒绝整份文件，绝不回退
			if !validAvatarDimensions(cfg.Width, cfg.Height) {
				return nil, "", errFriendAvatarTooLarge
			}
			img, err := png.Decode(bytes.NewReader(cand.data))
			if err == nil {
				return encodeThumbnailImage(img)
			}
			continue
		}
		if img, bomb, ok := decodeICODIBFrame(cand.data); bomb {
			return nil, "", errFriendAvatarTooLarge
		} else if ok {
			return encodeThumbnailImage(img)
		}
	}

	return nil, "", errFriendAvatarUnsupported
}

// decodeICODIBFrame 解析 ICO 中的未压缩 1/4/8/24/32 位 BITMAPINFOHEADER 帧（含调色板、底部向上行序与 1-bit AND 掩码）
func decodeICODIBFrame(dib []byte) (decoded image.Image, isBomb bool, ok bool) {
	if len(dib) < 40 {
		return nil, false, false
	}
	headerSize := binary.LittleEndian.Uint32(dib[0:4])
	if headerSize != 40 || int(headerSize) > len(dib) {
		return nil, false, false
	}
	w := int(int32(binary.LittleEndian.Uint32(dib[4:8])))
	rawH := int(int32(binary.LittleEndian.Uint32(dib[8:12])))
	topDown := false
	if rawH < 0 {
		if rawH == -1<<31 {
			return nil, true, false
		}
		topDown = true
		rawH = -rawH
	}
	h := rawH / 2
	if w <= 0 || h <= 0 {
		return nil, false, false
	}
	if w > 512 || h > 512 {
		return nil, true, false
	}
	planes := binary.LittleEndian.Uint16(dib[12:14])
	bpp := binary.LittleEndian.Uint16(dib[14:16])
	compression := binary.LittleEndian.Uint32(dib[16:20])
	clrUsed := int(binary.LittleEndian.Uint32(dib[32:36]))
	if planes != 1 || compression != 0 || !(bpp == 1 || bpp == 4 || bpp == 8 || bpp == 24 || bpp == 32) {
		return nil, false, false
	}

	paletteCount := 0
	if bpp <= 8 {
		maxColors := 1 << bpp
		if clrUsed > 0 && clrUsed <= maxColors {
			paletteCount = clrUsed
		} else {
			paletteCount = maxColors
		}
	}
	paletteOffset := int(headerSize)
	pixelOffset := paletteOffset + paletteCount*4
	if pixelOffset > len(dib) {
		return nil, false, false
	}

	var palette []color.NRGBA
	if paletteCount > 0 {
		palette = make([]color.NRGBA, paletteCount)
		for i := 0; i < paletteCount; i++ {
			off := paletteOffset + i*4
			palette[i] = color.NRGBA{
				B: dib[off],
				G: dib[off+1],
				R: dib[off+2],
				A: 0xff,
			}
		}
	}

	xorStride := ((w*int(bpp) + 31) / 32) * 4
	xorBytes := xorStride * h
	if pixelOffset+xorBytes > len(dib) {
		return nil, false, false
	}

	andStride := ((w + 31) / 32) * 4
	andOffset := pixelOffset + xorBytes
	hasAndMask := andOffset+andStride*h <= len(dib)

	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	anyNonZeroAlpha := false
	if bpp == 32 {
		for y := 0; y < h && !anyNonZeroAlpha; y++ {
			row := dib[pixelOffset+y*xorStride : pixelOffset+y*xorStride+w*4]
			for x := 0; x < w; x++ {
				if row[x*4+3] != 0 {
					anyNonZeroAlpha = true
					break
				}
			}
		}
	}

	for y := 0; y < h; y++ {
		srcY := h - 1 - y
		if topDown {
			srcY = y
		}
		row := dib[pixelOffset+srcY*xorStride : pixelOffset+(srcY+1)*xorStride]
		for x := 0; x < w; x++ {
			var px color.NRGBA
			switch bpp {
			case 32:
				px = color.NRGBA{R: row[x*4+2], G: row[x*4+1], B: row[x*4], A: 0xff}
				if anyNonZeroAlpha {
					px.A = row[x*4+3]
				}
			case 24:
				px = color.NRGBA{R: row[x*3+2], G: row[x*3+1], B: row[x*3], A: 0xff}
			case 8:
				idx := int(row[x])
				if idx < len(palette) {
					px = palette[idx]
				}
			case 4:
				bVal := row[x/2]
				var idx int
				if x%2 == 0 {
					idx = int(bVal >> 4)
				} else {
					idx = int(bVal & 0x0f)
				}
				if idx < len(palette) {
					px = palette[idx]
				}
			case 1:
				bit := (row[x/8] >> (7 - uint(x%8))) & 1
				if int(bit) < len(palette) {
					px = palette[bit]
				}
			}
			if !(bpp == 32 && anyNonZeroAlpha) && hasAndMask {
				maskByte := dib[andOffset+srcY*andStride+(x/8)]
				if (maskByte>>(7-uint(x%8)))&1 == 1 {
					px.A = 0
				}
			}
			img.SetNRGBA(x, y, px)
		}
	}
	return img, false, true
}

// isFriendAvifWithSafeISPE 严格校验静态 AVIF 顶层 ISO BMFF 盒结构与全部 ispe 属性盒宽高（禁止 avis 动图、grid/iovl 网格派生与 largesize 绕过）
func isFriendAvifWithSafeISPE(raw []byte) bool {
	if len(raw) < 28 || len(raw) > friendAvatarMaxAVIFBytes || string(raw[4:8]) != "ftyp" {
		return false
	}
	major := string(raw[8:12])
	if major == "avis" {
		return false
	}
	isAvifBrand := major == "avif"
	ftypSize := int(binary.BigEndian.Uint32(raw[0:4]))
	if ftypSize < 16 || ftypSize > len(raw) {
		return false
	}
	for offset := 16; offset+4 <= ftypSize; offset += 4 {
		brand := string(raw[offset : offset+4])
		if brand == "avis" {
			return false
		}
		if brand == "avif" {
			isAvifBrand = true
		}
	}
	if !isAvifBrand {
		return false
	}

	// 校验顶层 Box 链精确覆盖整份文件，拒绝尾部多态夹带、重复 meta 盒与动画轨 moov
	var metaSlice []byte
	hasMdat := false
	for pos := 0; pos < len(raw); {
		if pos+8 > len(raw) {
			return false
		}
		sz32 := binary.BigEndian.Uint32(raw[pos : pos+4])
		boxType := string(raw[pos+4 : pos+8])
		var boxLen int
		if sz32 == 0 {
			return false
		} else if sz32 == 1 {
			if pos+16 > len(raw) {
				return false
			}
			sz64 := binary.BigEndian.Uint64(raw[pos+8 : pos+16])
			if sz64 < 16 || sz64 > uint64(len(raw)-pos) {
				return false
			}
			boxLen = int(sz64)
		} else {
			if sz32 < 8 || int(sz32) > len(raw)-pos {
				return false
			}
			boxLen = int(sz32)
		}
		switch boxType {
		case "moov":
			return false
		case "meta":
			if metaSlice != nil {
				return false
			}
			metaSlice = raw[pos : pos+boxLen]
		case "mdat":
			hasMdat = true
		}
		pos += boxLen
	}
	if len(metaSlice) == 0 || !hasMdat {
		return false
	}

	// 仅在 meta 元数据盒内拦截 grid / iovl 派生大图拼贴与校验全部 ispe 属性（避免 mdat 压缩像素流偶合误伤）
	if bytes.Contains(metaSlice, []byte("grid")) || bytes.Contains(metaSlice, []byte("iovl")) {
		return false
	}
	foundISPE := false
	for idx := 0; idx+8 <= len(metaSlice); idx++ {
		if metaSlice[idx+4] == 'i' && metaSlice[idx+5] == 's' && metaSlice[idx+6] == 'p' && metaSlice[idx+7] == 'e' {
			if idx+20 > len(metaSlice) {
				return false
			}
			boxSize := binary.BigEndian.Uint32(metaSlice[idx : idx+4])
			if boxSize != 20 || metaSlice[idx+8] != 0 || metaSlice[idx+9] != 0 || metaSlice[idx+10] != 0 || metaSlice[idx+11] != 0 {
				return false
			}
			w := binary.BigEndian.Uint32(metaSlice[idx+12 : idx+16])
			h := binary.BigEndian.Uint32(metaSlice[idx+16 : idx+20])
			if w == 0 || h == 0 || w > friendAvatarMaxAVIFDimension || h > friendAvatarMaxAVIFDimension {
				return false
			}
			foundISPE = true
		}
	}
	return foundISPE
}
