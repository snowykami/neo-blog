package service

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
	"golang.org/x/net/html/charset"
	"golang.org/x/sync/singleflight"
)

// 外链预览服务：
//   - 权限与白名单：编辑者与管理员可直接查询（供编辑器实时预览）；访客与普通用户必须提供公开文章 / 页面 / 侧边栏目标，且 URL 存在于其中
//   - 按正文哈希提取并缓存外链集合，无需修改数据库表，历史存量文章直接生效
//   - SSRF 防护：逐跳校验 URL 与解析出的 IP，拦截私网 / 回环 / 元数据地址，放行常见代理 Fake-IP 段，双栈解析时自动跳过不可用地址
//   - 结果缓存：存入 sharedstate（配置 Redis 时多副本共享），按元信息完整度与失败状态区分 TTL

const (
	linkPreviewMaxRedirects = 5
	linkPreviewTimeout      = 10 * time.Second
	linkPreviewDialTimeout  = 5 * time.Second
	linkPreviewMaxBytes     = 1 << 20 // 最多读取 1 MiB（读到 </head> 即提前结束）
	linkPreviewSniffBytes   = 64      // 非网页资源嗅探图片魔数的字节数

	linkPreviewSuccessTTL = 12 * time.Hour   // 正常抓取结果缓存 12 小时
	linkPreviewEmptyTTL   = 30 * time.Minute // 页面无标题/摘要/封面时缓存 30 分钟
	linkPreviewFailureTTL = 2 * time.Minute  // 上游超时或拦截时短期缓存 2 分钟，避免反复冲击
	linkPreviewURLSetTTL  = 24 * time.Hour   // 按正文哈希缓存的 URL 集合 TTL

	linkPreviewURLSetMemMax = 500

	// 伪装成常规桌面浏览器访问，减少被 Cloudflare 等 WAF 误判为野生爬虫返回 403 的概率
	linkPreviewUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"

	TargetTypeSidebar = "sidebar"
)

var (
	errLinkPreviewBlockedAddr = errors.New("blocked link preview address")

	// 常见代理软件（Clash / Mihomo / Surge / Sing-box 等）使用的 Fake-IP 段：不含云厂商元数据与常规局域网地址
	fakeIPv4Prefix = netip.MustParsePrefix("198.18.0.0/15")
	fakeIPv6Prefix = netip.MustParsePrefix("fc00::/18")

	// 补充排除的特殊 IPv6 / 文档地址段
	extraBlockedPrefixes = []netip.Prefix{
		netip.MustParsePrefix("192.0.2.0/24"),    // TEST-NET-1
		netip.MustParsePrefix("198.51.100.0/24"), // TEST-NET-2
		netip.MustParsePrefix("203.0.113.0/24"),  // TEST-NET-3
		netip.MustParsePrefix("100::/64"),        // 丢弃前缀
		netip.MustParsePrefix("2001::/32"),       // Teredo
		netip.MustParsePrefix("2001:db8::/32"),   // 文档地址
	}

	acceptLangTagPattern = regexp.MustCompile(`^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$`)
	headEndPattern       = regexp.MustCompile(`(?i)</head\s*>`)

	// 测试中可替换 DNS 解析、拨号器、RoundTripper 与本机私网开关
	linkPreviewAllowPrivate = false
	linkPreviewLookupNetIP  = func(ctx context.Context, host string) ([]netip.Addr, error) {
		return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	}
	linkPreviewDial = func(ctx context.Context, network, address string) (net.Conn, error) {
		dialer := &net.Dialer{Timeout: linkPreviewDialTimeout}
		return dialer.DialContext(ctx, network, address)
	}

	linkPreviewFetchGroup singleflight.Group

	// 按不可变的正文哈希缓存已提取的 URL 集合，避免每次悬停重新扫描 HTML
	urlSetMemCache = struct {
		sync.Mutex
		entries map[string]map[string]struct{}
	}{entries: make(map[string]map[string]struct{})}
)

type cachedLinkPreview struct {
	Data   *dto.LinkPreviewDto `json:"data,omitempty"`
	Failed string              `json:"failed,omitempty"`
}

type LinkPreviewService struct{}

var LinkPreview = &LinkPreviewService{}

func NewLinkPreviewService() *LinkPreviewService {
	return LinkPreview
}

// IsLinkPreviewAllowedAddr 判断目标 IP 是否允许外链预览连接：允许公网地址及常见代理 Fake-IP 段，拦截回环、私网与云元数据地址
func IsLinkPreviewAllowedAddr(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsValid() {
		return false
	}
	if fakeIPv4Prefix.Contains(addr) || fakeIPv6Prefix.Contains(addr) {
		return true
	}
	if !utils.IsPublicAddr(addr) {
		return false
	}
	for _, prefix := range extraBlockedPrefixes {
		if prefix.Contains(addr) {
			return false
		}
	}
	return true
}

// NormalizeLinkPreviewURL 校验并规范化外链地址，使正文 HTML 提取结果与浏览器传入的 href 一致
func NormalizeLinkPreviewURL(raw string) (string, *url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil, errLinkPreviewBlockedAddr
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return "", nil, errLinkPreviewBlockedAddr
	}
	scheme := strings.ToLower(u.Scheme)
	if !(scheme == "http" || scheme == "https") {
		return "", nil, errLinkPreviewBlockedAddr
	}
	if u.User != nil {
		return "", nil, errLinkPreviewBlockedAddr
	}
	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	if host == "" {
		return "", nil, errLinkPreviewBlockedAddr
	}
	if !(linkPreviewAllowPrivate || utils.SafeFetchAllowPrivate) {
		if host == "localhost" || strings.HasSuffix(host, ".localhost") {
			return "", nil, errLinkPreviewBlockedAddr
		}
		if ip, err := netip.ParseAddr(host); err == nil && !IsLinkPreviewAllowedAddr(ip) {
			return "", nil, errLinkPreviewBlockedAddr
		}
	}

	u.Scheme = scheme
	port := u.Port()
	if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		port = ""
	}
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
	normalized := uppercasePercentEncoding(u.String())
	parsedNorm, err := url.Parse(normalized)
	if err != nil {
		return "", nil, errLinkPreviewBlockedAddr
	}
	return normalized, parsedNorm, nil
}

// uppercasePercentEncoding 把百分号编码统一成大写十六进制，消除 %e4 与 %E4 的比较差异
func uppercasePercentEncoding(s string) string {
	if !strings.Contains(s, "%") {
		return s
	}
	b := []byte(s)
	for i := 0; i+2 < len(b); i++ {
		if b[i] == '%' && isHexByte(b[i+1]) && isHexByte(b[i+2]) {
			if b[i+1] >= 'a' && b[i+1] <= 'f' {
				b[i+1] -= 'a' - 'A'
			}
			if b[i+2] >= 'a' && b[i+2] <= 'f' {
				b[i+2] -= 'a' - 'A'
			}
			i += 2
		}
	}
	return string(b)
}

func isHexByte(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

// Get 获取外链预览信息；第二个返回值为是否可由公共缓存（浏览器 public）缓存
func (s *LinkPreviewService) Get(ctx context.Context, req *dto.LinkPreviewReq, acceptLanguage string) (*dto.LinkPreviewDto, bool, *errs.ServiceError) {
	if req == nil || strings.TrimSpace(req.URL) == "" {
		return nil, false, errs.NewBadRequest("url_is_required")
	}
	normalizedURL, parsedURL, err := NormalizeLinkPreviewURL(req.URL)
	if err != nil {
		return nil, false, errs.NewBadRequest("invalid_or_blocked_url")
	}

	targetType := strings.TrimSpace(req.TargetType)
	inPublicTarget := targetType != "" && isURLAllowedForTarget(targetType, req.TargetID, normalizedURL)
	if !inPublicTarget {
		currentUser, ok := ctxutils.GetCurrentUser(ctx)
		if !(ok && currentUser != nil && (currentUser.IsAdmin() || currentUser.IsEditor())) {
			return nil, false, errs.NewForbidden("link_preview_not_allowed")
		}
	}

	lang := normalizePreviewAcceptLanguage(acceptLanguage)
	cacheKey := fmt.Sprintf("link_preview:v1:%s:%s", lang, normalizedURL)

	var cached cachedLinkPreview
	if hit, err := sharedstate.GetJSON(cacheKey, &cached); err == nil && hit {
		if cached.Data != nil {
			out := *cached.Data
			out.URL = req.URL
			return &out, inPublicTarget, nil
		}
		if cached.Failed != "" {
			return nil, false, errs.New(http.StatusBadGateway, "link_preview_fetch_failed", errors.New(cached.Failed))
		}
	}

	val, fetchErr, _ := linkPreviewFetchGroup.Do(cacheKey, func() (any, error) {
		var recheck cachedLinkPreview
		if hit, err := sharedstate.GetJSON(cacheKey, &recheck); err == nil && hit {
			if recheck.Data != nil {
				return recheck.Data, nil
			}
			if recheck.Failed != "" {
				return nil, errors.New(recheck.Failed)
			}
		}

		preview, err := fetchLinkPreview(context.WithoutCancel(ctx), parsedURL, normalizedURL, lang)
		if err != nil {
			if !errors.Is(err, errLinkPreviewBlockedAddr) {
				logrus.Debugf("link preview fetch failed (%s): %v", parsedURL.Host, err)
				_ = sharedstate.SetJSON(cacheKey, cachedLinkPreview{Failed: err.Error()}, linkPreviewFailureTTL)
			}
			return nil, err
		}
		ttl := linkPreviewSuccessTTL
		if preview.Title == "" && preview.Description == "" && preview.Image == "" {
			ttl = linkPreviewEmptyTTL
		}
		_ = sharedstate.SetJSON(cacheKey, cachedLinkPreview{Data: preview}, ttl)
		return preview, nil
	})
	if fetchErr != nil {
		if errors.Is(fetchErr, errLinkPreviewBlockedAddr) {
			return nil, false, errs.NewBadRequest("invalid_or_blocked_url")
		}
		return nil, false, errs.New(http.StatusBadGateway, "link_preview_fetch_failed", fetchErr)
	}

	out := *(val.(*dto.LinkPreviewDto))
	out.URL = req.URL
	return &out, inPublicTarget, nil
}

// isURLAllowedForTarget 校验 normalizedURL 是否存在于指定的公开内容（文章 / 页面 / 侧边栏）中
func isURLAllowedForTarget(targetType string, targetID uint, normalizedURL string) bool {
	switch targetType {
	case constant.TargetTypePost:
		if targetID == 0 {
			return false
		}
		hash, err := repo.Post.GetPublicPostContentHash(targetID)
		if err != nil {
			return false
		}
		if hash != "" {
			if set, ok := lookupCachedURLSet(hash); ok {
				return matchNormalizedURL(set, normalizedURL)
			}
		}
		content, contentHash, err := repo.Post.GetPublicPostContent(targetID)
		if err != nil {
			return false
		}
		if contentHash == "" {
			contentHash = model.HashContent(content)
		}
		set := getOrExtractURLSet(contentHash, content)
		return matchNormalizedURL(set, normalizedURL)

	case constant.TargetTypePage:
		if targetID == 0 {
			return false
		}
		content, err := repo.Page.GetPublicPageContent(targetID)
		if err != nil {
			return false
		}
		contentHash := model.HashContent(content)
		set := getOrExtractURLSet(contentHash, content)
		return matchNormalizedURL(set, normalizedURL)

	case TargetTypeSidebar:
		set := extractSidebarURLSet(config.Value("sidebar_cards"))
		return matchNormalizedURL(set, normalizedURL)

	default:
		return false
	}
}

func matchNormalizedURL(set map[string]struct{}, normalizedURL string) bool {
	if _, ok := set[normalizedURL]; ok {
		return true
	}
	// 兜底：若请求或原文相差无意义的空锚点 #，去掉后再比对一次
	if trimmed, found := strings.CutSuffix(normalizedURL, "#"); found {
		_, ok := set[trimmed]
		return ok
	}
	return false
}

func lookupCachedURLSet(contentHash string) (map[string]struct{}, bool) {
	urlSetMemCache.Lock()
	set, ok := urlSetMemCache.entries[contentHash]
	urlSetMemCache.Unlock()
	if ok {
		return set, true
	}
	var list []string
	if hit, err := sharedstate.GetJSON("link_preview:urls:"+contentHash, &list); err == nil && hit {
		set = sliceToSet(list)
		storeMemURLSet(contentHash, set)
		return set, true
	}
	return nil, false
}

func getOrExtractURLSet(contentHash, content string) map[string]struct{} {
	if set, ok := lookupCachedURLSet(contentHash); ok {
		return set
	}
	set := ExtractContentExternalURLs(content)
	storeMemURLSet(contentHash, set)
	list := make([]string, 0, len(set))
	for u := range set {
		list = append(list, u)
	}
	_ = sharedstate.SetJSON("link_preview:urls:"+contentHash, list, linkPreviewURLSetTTL)
	return set
}

func storeMemURLSet(contentHash string, set map[string]struct{}) {
	urlSetMemCache.Lock()
	defer urlSetMemCache.Unlock()
	if len(urlSetMemCache.entries) >= linkPreviewURLSetMemMax {
		for k := range urlSetMemCache.entries {
			delete(urlSetMemCache.entries, k)
			if len(urlSetMemCache.entries) < linkPreviewURLSetMemMax {
				break
			}
		}
	}
	urlSetMemCache.entries[contentHash] = set
}

func sliceToSet(list []string) map[string]struct{} {
	set := make(map[string]struct{}, len(list))
	for _, item := range list {
		set[item] = struct{}{}
	}
	return set
}

// ExtractContentExternalURLs 从正文 HTML 中提取全部外链（含 <a href> 与 linkCard 组件的 data-props）并规范化
func ExtractContentExternalURLs(content string) map[string]struct{} {
	result := make(map[string]struct{})
	if content == "" {
		return result
	}
	addURL := func(raw string) {
		if norm, _, err := NormalizeLinkPreviewURL(raw); err == nil {
			result[norm] = struct{}{}
		}
	}

	z := html.NewTokenizer(strings.NewReader(content))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		name, hasAttr := z.TagName()
		if !hasAttr {
			continue
		}
		tag := atom.Lookup(name)
		var componentName, dataProps string
		for {
			k, v, more := z.TagAttr()
			key := string(k)
			if tag == atom.A && key == "href" {
				addURL(string(v))
			} else if key == "data-component" {
				componentName = string(v)
			} else if key == "data-props" {
				dataProps = string(v)
			}
			if !more {
				break
			}
		}
		if componentName == "linkCard" && dataProps != "" {
			var props struct {
				URL string `json:"url"`
			}
			if json.Unmarshal([]byte(dataProps), &props) == nil && props.URL != "" {
				addURL(props.URL)
			}
		}
	}
	return result
}

// extractSidebarURLSet 从站点侧边栏卡片配置中提取 linkCard 组件的 URL
func extractSidebarURLSet(raw any) map[string]struct{} {
	result := make(map[string]struct{})
	if raw == nil {
		return result
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return result
	}
	var cards []struct {
		Type  string `json:"type"`
		Name  string `json:"name"`
		Props struct {
			URL string `json:"url"`
		} `json:"props"`
	}
	if json.Unmarshal(data, &cards) != nil {
		return result
	}
	for _, card := range cards {
		if card.Type == "component" && card.Name == "linkCard" && card.Props.URL != "" {
			if norm, _, err := NormalizeLinkPreviewURL(card.Props.URL); err == nil {
				result[norm] = struct{}{}
			}
		}
	}
	return result
}

// normalizePreviewAcceptLanguage 取读者首选语言构造固定格式的 Accept-Language，减少同语种的重复缓存
func normalizePreviewAcceptLanguage(header string) string {
	first := strings.TrimSpace(strings.Split(strings.Split(header, ",")[0], ";")[0])
	if !acceptLangTagPattern.MatchString(first) {
		return "zh-CN,zh;q=0.9,en;q=0.8"
	}
	base := strings.Split(first, "-")[0]
	tags := []string{first}
	if !strings.EqualFold(base, first) {
		tags = append(tags, strings.ToLower(base))
	}
	if !strings.EqualFold(base, "en") {
		tags = append(tags, "en")
	}
	parts := make([]string, 0, len(tags))
	for i, tag := range tags {
		if i == 0 {
			parts = append(parts, tag)
		} else {
			parts = append(parts, fmt.Sprintf("%s;q=%.1f", tag, 1.0-float64(i)*0.1))
		}
	}
	return strings.Join(parts, ",")
}

// resolvePreviewFetchURL 已知站点的抓取地址改写：网易云音乐 #/ 路由改为同源服务端渲染地址
func resolvePreviewFetchURL(u *url.URL) *url.URL {
	if strings.EqualFold(u.Hostname(), "music.163.com") && strings.HasPrefix(u.Fragment, "/") {
		base := &url.URL{Scheme: u.Scheme, Host: u.Host}
		if rewritten, err := base.Parse(u.Fragment); err == nil && rewritten.Scheme == u.Scheme && strings.EqualFold(rewritten.Host, u.Host) {
			return rewritten
		}
	}
	return u
}

func linkPreviewDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	var resolved []netip.Addr
	if ip, parseErr := netip.ParseAddr(host); parseErr == nil {
		resolved = []netip.Addr{ip}
	} else {
		resolved, err = linkPreviewLookupNetIP(ctx, host)
		if err != nil {
			return nil, err
		}
	}

	// 过滤掉不可访问的私网/保留地址，双栈域名中若 IPv6 为保留地址而 IPv4 合法，仍使用合法地址连接；IPv4 优先以避免无 IPv6 出口的容器超时
	v4 := make([]netip.Addr, 0, len(resolved))
	v6 := make([]netip.Addr, 0, len(resolved))
	allowPrivate := linkPreviewAllowPrivate || utils.SafeFetchAllowPrivate
	for _, addr := range resolved {
		unmapped := addr.Unmap()
		if !(allowPrivate || IsLinkPreviewAllowedAddr(unmapped)) {
			continue
		}
		if unmapped.Is4() {
			v4 = append(v4, unmapped)
		} else {
			v6 = append(v6, unmapped)
		}
	}
	candidates := append(v4, v6...)
	if len(candidates) == 0 {
		return nil, errLinkPreviewBlockedAddr
	}

	var lastErr error
	for _, addr := range candidates {
		conn, dialErr := linkPreviewDial(ctx, network, net.JoinHostPort(addr.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
		if ctx.Err() != nil {
			break
		}
	}
	return nil, lastErr
}

var linkPreviewTransport = &http.Transport{
	Proxy:                 nil,
	DialContext:           linkPreviewDialContext,
	TLSHandshakeTimeout:   5 * time.Second,
	ResponseHeaderTimeout: 8 * time.Second,
	MaxIdleConns:          32,
	MaxIdleConnsPerHost:   4,
	IdleConnTimeout:       30 * time.Second,
}

var linkPreviewRoundTripper http.RoundTripper = linkPreviewTransport

func fetchLinkPreview(ctx context.Context, target *url.URL, requestedURL, acceptLanguage string) (*dto.LinkPreviewDto, error) {
	ctx, cancel := context.WithTimeout(ctx, linkPreviewTimeout)
	defer cancel()

	current := resolvePreviewFetchURL(target)
	for hop := 0; hop <= linkPreviewMaxRedirects; hop++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, current.String(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", linkPreviewUserAgent)
		req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
		req.Header.Set("Accept-Language", acceptLanguage)
		req.Header.Set("Accept-Encoding", "gzip, deflate")
		req.Header.Set("Upgrade-Insecure-Requests", "1")

		resp, err := linkPreviewRoundTripper.RoundTrip(req)
		if err != nil {
			return nil, err
		}

		status := resp.StatusCode
		if status == http.StatusMovedPermanently || status == http.StatusFound || status == http.StatusSeeOther ||
			status == http.StatusTemporaryRedirect || status == http.StatusPermanentRedirect {
			loc := resp.Header.Get("Location")
			_ = resp.Body.Close()
			if loc == "" {
				return nil, fmt.Errorf("redirect %d without location", status)
			}
			nextRaw, err := current.Parse(loc)
			if err != nil {
				return nil, err
			}
			_, nextNorm, err := NormalizeLinkPreviewURL(nextRaw.String())
			if err != nil {
				return nil, err
			}
			current = resolvePreviewFetchURL(nextNorm)
			continue
		}

		if status < 200 || status >= 300 {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("upstream status %d", status)
		}

		contentType := resp.Header.Get("Content-Type")
		contentEncoding := resp.Header.Get("Content-Encoding")
		lowerType := strings.ToLower(contentType)
		isImageHeader := strings.HasPrefix(strings.TrimSpace(lowerType), "image/") && !strings.Contains(lowerType, "svg")
		isNonHTML := contentType != "" && !strings.Contains(lowerType, "html") && !strings.Contains(lowerType, "xml")

		if isImageHeader || isNonHTML {
			head, readErr := readPreviewHead(resp.Body, contentEncoding, linkPreviewSniffBytes, false)
			_ = resp.Body.Close()
			if readErr != nil && len(head) == 0 {
				return nil, readErr
			}
			return buildFilePreview(current, requestedURL, isImageHeader || isImageMagicBytes(head)), nil
		}

		// SVG 图片以封面形式返回
		if strings.HasPrefix(strings.TrimSpace(lowerType), "image/svg") {
			_ = resp.Body.Close()
			return buildFilePreview(current, requestedURL, true), nil
		}

		bodyBytes, readErr := readPreviewHead(resp.Body, contentEncoding, linkPreviewMaxBytes, true)
		_ = resp.Body.Close()
		if readErr != nil && len(bodyBytes) == 0 {
			return nil, readErr
		}
		decodedHTML := decodePreviewHTML(bodyBytes, contentType)
		return extractHTMLPreviewMetadata(decodedHTML, current, requestedURL), nil
	}
	return nil, errors.New("too many redirects")
}

// readPreviewHead 解压并读取响应头部的字节；stopAtHeadEnd 为 true 时读到 </head> 立即停止以节省带宽
func readPreviewHead(raw io.Reader, contentEncoding string, limit int, stopAtHeadEnd bool) ([]byte, error) {
	reader, cleanup, err := wrapDecompressReader(raw, contentEncoding)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	var buf bytes.Buffer
	chunk := make([]byte, 4096)
	tail := ""
	for buf.Len() < limit {
		toRead := len(chunk)
		if rem := limit - buf.Len(); rem < toRead {
			toRead = rem
		}
		n, readErr := reader.Read(chunk[:toRead])
		if n > 0 {
			part := chunk[:n]
			buf.Write(part)
			if stopAtHeadEnd {
				window := tail + string(part)
				if headEndPattern.MatchString(window) {
					break
				}
				if len(window) > 16 {
					tail = window[len(window)-16:]
				} else {
					tail = window
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			// 已读出有效头部数据时，忽略流尾截断导致的解压告警
			if buf.Len() > 0 {
				break
			}
			return nil, readErr
		}
	}
	out := buf.Bytes()
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func wrapDecompressReader(raw io.Reader, contentEncoding string) (io.Reader, func(), error) {
	enc := strings.ToLower(strings.TrimSpace(contentEncoding))
	switch enc {
	case "", "identity":
		return raw, func() {}, nil
	case "gzip", "x-gzip":
		gr, err := gzip.NewReader(raw)
		if err != nil {
			return nil, func() {}, err
		}
		return gr, func() { _ = gr.Close() }, nil
	case "deflate":
		// HTTP deflate 可能是 zlib 包装，也可能是裸 deflate：预读 2 字节按魔数区分
		var header [2]byte
		n, err := io.ReadFull(raw, header[:])
		if n == 0 {
			if err == io.EOF {
				return bytes.NewReader(nil), func() {}, nil
			}
			return nil, func() {}, err
		}
		combined := io.MultiReader(bytes.NewReader(header[:n]), raw)
		if n == 2 && isZlibHeader(header) {
			if zr, zerr := zlib.NewReader(combined); zerr == nil {
				return zr, func() { _ = zr.Close() }, nil
			}
		}
		fr := flate.NewReader(combined)
		return fr, func() { _ = fr.Close() }, nil
	default:
		return raw, func() {}, nil
	}
}

func isZlibHeader(h [2]byte) bool {
	cmf := int(h[0])
	flg := int(h[1])
	return (cmf&0x0f) == 8 && (cmf>>4) <= 7 && ((cmf<<8)+flg)%31 == 0
}

// decodePreviewHTML 按 BOM、Content-Type 与 <meta charset> 识别编码并转为 UTF-8（兼容 GBK / GB2312 / Shift_JIS 等站点）
func decodePreviewHTML(data []byte, contentType string) string {
	if len(data) == 0 {
		return ""
	}
	r, err := charset.NewReader(bytes.NewReader(data), contentType)
	if err != nil {
		return string(data)
	}
	decoded, err := io.ReadAll(r)
	if err != nil && len(decoded) == 0 {
		return string(data)
	}
	if !utf8.Valid(decoded) {
		return strings.ToValidUTF8(string(decoded), "")
	}
	return string(decoded)
}

func isImageMagicBytes(buf []byte) bool {
	if len(buf) >= 4 && buf[0] == 0x89 && buf[1] == 'P' && buf[2] == 'N' && buf[3] == 'G' {
		return true
	}
	if len(buf) >= 3 && buf[0] == 0xFF && buf[1] == 0xD8 && buf[2] == 0xFF {
		return true
	}
	if len(buf) >= 4 && string(buf[:4]) == "GIF8" {
		return true
	}
	if len(buf) >= 12 && string(buf[:4]) == "RIFF" && string(buf[8:12]) == "WEBP" {
		return true
	}
	if len(buf) >= 12 && string(buf[4:8]) == "ftyp" {
		brand := string(buf[8:12])
		return brand == "avif" || brand == "avis"
	}
	return false
}

func resolveResourceHTTPURL(raw string, base *url.URL) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || base == nil {
		return ""
	}
	resolved, err := base.Parse(raw)
	if err != nil {
		return ""
	}
	scheme := strings.ToLower(resolved.Scheme)
	if scheme != "http" && scheme != "https" {
		return ""
	}
	return resolved.String()
}

func cleanPreviewText(s string, maxRunes int) string {
	collapsed := strings.Join(strings.Fields(s), " ")
	runes := []rune(collapsed)
	if len(runes) > maxRunes {
		return string(runes[:maxRunes])
	}
	return collapsed
}

func extractHTMLPreviewMetadata(rawHTML string, finalURL *url.URL, requestedURL string) *dto.LinkPreviewDto {
	meta := make(map[string]string)
	var pageTitle strings.Builder
	var gotTitle, inTitle bool
	svgDepth := 0
	var imageSrcHref, iconHref, appleIconHref string

	z := html.NewTokenizer(strings.NewReader(rawHTML))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		switch tt {
		case html.StartTagToken, html.SelfClosingTagToken:
			nameBytes, hasAttr := z.TagName()
			tagName := strings.ToLower(string(nameBytes))
			if tagName == "svg" && tt == html.StartTagToken {
				svgDepth++
				continue
			}
			if tagName == "title" && svgDepth == 0 && !gotTitle && tt == html.StartTagToken {
				inTitle = true
				continue
			}
			if !hasAttr {
				continue
			}
			attrs := make(map[string]string, 4)
			for {
				k, v, more := z.TagAttr()
				attrs[strings.ToLower(string(k))] = string(v)
				if !more {
					break
				}
			}
			switch tagName {
			case "meta":
				content := strings.TrimSpace(attrs["content"])
				if content == "" {
					continue
				}
				for _, attrKey := range []string{"property", "name", "itemprop"} {
					if prop := strings.ToLower(strings.TrimSpace(attrs[attrKey])); prop != "" {
						if _, exists := meta[prop]; !exists {
							meta[prop] = content
						}
					}
				}
			case "link":
				href := strings.TrimSpace(attrs["href"])
				if href == "" {
					continue
				}
				rel := strings.ToLower(attrs["rel"])
				relTokens := strings.Fields(rel)
				for _, token := range relTokens {
					if token == "icon" && iconHref == "" {
						iconHref = href
					}
				}
				if (rel == "apple-touch-icon" || rel == "apple-touch-icon-precomposed") && appleIconHref == "" {
					appleIconHref = href
				}
				if rel == "image_src" && imageSrcHref == "" {
					imageSrcHref = href
				}
			}

		case html.TextToken:
			if inTitle {
				pageTitle.Write(z.Text())
			}

		case html.EndTagToken:
			nameBytes, _ := z.TagName()
			tagName := strings.ToLower(string(nameBytes))
			if tagName == "svg" && svgDepth > 0 {
				svgDepth--
			} else if tagName == "title" && inTitle {
				inTitle = false
				gotTitle = true
			} else if tagName == "head" {
				goto done
			}
		}
	}

done:
	pickMeta := func(keys ...string) string {
		for _, k := range keys {
			if v := meta[k]; v != "" {
				return v
			}
		}
		return ""
	}

	title := pickMeta("og:title", "twitter:title")
	if title == "" {
		title = pageTitle.String()
	}
	description := pickMeta("og:description", "twitter:description", "description")
	image := pickMeta("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")
	if image == "" {
		image = imageSrcHref
	}
	favicon := iconHref
	if favicon == "" {
		favicon = appleIconHref
	}
	resolvedFavicon := resolveResourceHTTPURL(favicon, finalURL)
	if resolvedFavicon == "" && finalURL != nil {
		resolvedFavicon = fmt.Sprintf("%s://%s/favicon.ico", finalURL.Scheme, finalURL.Host)
	}
	siteName := cleanPreviewText(pickMeta("og:site_name"), 100)
	if siteName == "" && finalURL != nil {
		siteName = finalURL.Hostname()
	}

	return &dto.LinkPreviewDto{
		Title:       cleanPreviewText(title, 100),
		Description: cleanPreviewText(description, 200),
		Image:       resolveResourceHTTPURL(image, finalURL),
		Favicon:     resolvedFavicon,
		URL:         requestedURL,
		SiteName:    siteName,
	}
}

func buildFilePreview(finalURL *url.URL, requestedURL string, isImage bool) *dto.LinkPreviewDto {
	var fileName string
	if !isImage && finalURL != nil {
		trimmed := strings.TrimRight(finalURL.Path, "/")
		if trimmed != "" {
			base := path.Base(trimmed)
			if base != "." && base != "/" {
				if decoded, err := url.PathUnescape(base); err == nil {
					fileName = decoded
				} else {
					fileName = base
				}
			}
		}
	}
	var imageURL, favicon, siteName string
	if finalURL != nil {
		if isImage {
			imageURL = finalURL.String()
		}
		favicon = fmt.Sprintf("%s://%s/favicon.ico", finalURL.Scheme, finalURL.Host)
		siteName = finalURL.Hostname()
	}
	return &dto.LinkPreviewDto{
		Title:       cleanPreviewText(fileName, 100),
		Description: "",
		Image:       imageURL,
		Favicon:     favicon,
		URL:         requestedURL,
		SiteName:    siteName,
	}
}
