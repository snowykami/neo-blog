package utils

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// 安全获取外部资源（防 SSRF）：校验 URL、端口与解析出的每个目标地址（含重定向每一跳），拦截私网、回环、链路本地与云元数据地址

// SafeFetchAllowPrivate 测试中访问本机测试服务器时打开，生产环境不得修改
var SafeFetchAllowPrivate = false

// ErrBlockedAddress 目标地址或端口不满足防 SSRF 安全策略
var ErrBlockedAddress = errors.New("blocked address")

var (
	// 常见代理软件（Clash / Mihomo / Surge / Sing-box 等）使用的 Fake-IP 段：不含云厂商元数据与常规局域网地址
	fakeIPv4Prefix = netip.MustParsePrefix("198.18.0.0/15")
	fakeIPv6Prefix = netip.MustParsePrefix("fc00::/18")

	// blockedPrefixes 不属于 netip 内置判断、但同样不应作为公网目标访问的保留与特殊网段
	blockedPrefixes = []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/8"),       // 本网络
		netip.MustParsePrefix("100.64.0.0/10"),   // 运营商级 NAT（含部分云元数据网段）
		netip.MustParsePrefix("192.0.0.0/24"),    // IETF 协议分配
		netip.MustParsePrefix("192.0.2.0/24"),    // TEST-NET-1
		netip.MustParsePrefix("192.88.99.0/24"),  // 6to4 中继
		netip.MustParsePrefix("198.18.0.0/15"),   // 基准测试 / Fake-IP
		netip.MustParsePrefix("198.51.100.0/24"), // TEST-NET-2
		netip.MustParsePrefix("203.0.113.0/24"),  // TEST-NET-3
		netip.MustParsePrefix("240.0.0.0/4"),     // 保留
		netip.MustParsePrefix("64:ff9b::/96"),    // NAT64，可映射到内网 IPv4
		netip.MustParsePrefix("100::/64"),        // 丢弃前缀
		netip.MustParsePrefix("2001::/32"),       // Teredo
		netip.MustParsePrefix("2001:db8::/32"),   // 文档地址
		netip.MustParsePrefix("2002::/16"),       // 6to4
		netip.MustParsePrefix("fec0::/10"),       // 已废弃的站点本地地址
	}
)

// IsPublicAddr 地址是否为可访问的公网地址
func IsPublicAddr(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsValid() || addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() ||
		addr.IsInterfaceLocalMulticast() || addr.IsMulticast() || addr.IsUnspecified() {
		return false
	}
	for _, prefix := range blockedPrefixes {
		if prefix.Contains(addr) {
			return false
		}
	}
	return true
}

// IsPublicOrFakeIPAddr 允许公网地址及常见代理 Fake-IP 段（198.18.0.0/15、fc00::/18），仍拦截回环、私网与云元数据地址
func IsPublicOrFakeIPAddr(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsValid() {
		return false
	}
	if fakeIPv4Prefix.Contains(addr) || fakeIPv6Prefix.Contains(addr) {
		return true
	}
	return IsPublicAddr(addr)
}

// SafeDialOptions 防 SSRF 安全拨号配置
type SafeDialOptions struct {
	DialTimeout  time.Duration
	AllowAnyPort bool                                                         // 为 false 时仅允许 80 / 443 端口
	AllowPrivate func() bool                                                  // 可选动态私网放行开关（仅测试用）
	AllowAddr    func(netip.Addr) bool                                        // 自定义地址准入判断，默认 IsPublicAddr
	LookupNetIP  func(ctx context.Context, host string) ([]netip.Addr, error) // 可选自定义 DNS 解析钩子
	Dial         func(ctx context.Context, network, address string) (net.Conn, error)
}

// NewSafeDialContext 构造防 SSRF 的 DialContext：
// 先解析并过滤掉不可访问的保留地址（双栈域名中合法 IPv4 优先，避免无 IPv6 出口超时或单栈保留地址误杀），
// 并在底层 socket 建立前二次校验目标 IP 与端口，彻底阻断 DNS 重绑定绕过。
func NewSafeDialContext(opts SafeDialOptions) func(ctx context.Context, network, address string) (net.Conn, error) {
	dialTimeout := opts.DialTimeout
	if dialTimeout <= 0 {
		dialTimeout = 5 * time.Second
	}
	isAddrAllowed := func(addr netip.Addr) bool {
		if opts.AllowAddr != nil {
			return opts.AllowAddr(addr)
		}
		return IsPublicAddr(addr)
	}
	isPrivateAllowed := func() bool {
		return SafeFetchAllowPrivate || (opts.AllowPrivate != nil && opts.AllowPrivate())
	}
	isPortAllowed := func(port string) bool {
		return opts.AllowAnyPort || port == "80" || port == "443" || isPrivateAllowed()
	}

	defaultDialer := &net.Dialer{
		Timeout: dialTimeout,
		Control: func(network, address string, _ syscall.RawConn) error {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if !isPortAllowed(port) {
				return ErrBlockedAddress
			}
			addr, err := netip.ParseAddr(host)
			if err != nil {
				return err
			}
			if !(isPrivateAllowed() || isAddrAllowed(addr.Unmap())) {
				return ErrBlockedAddress
			}
			return nil
		},
	}

	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		if !isPortAllowed(port) {
			return nil, ErrBlockedAddress
		}

		var resolved []netip.Addr
		if ip, parseErr := netip.ParseAddr(host); parseErr == nil {
			resolved = []netip.Addr{ip}
		} else {
			lookup := opts.LookupNetIP
			if lookup == nil {
				lookup = func(ctx context.Context, h string) ([]netip.Addr, error) {
					return net.DefaultResolver.LookupNetIP(ctx, "ip", h)
				}
			}
			resolved, err = lookup(ctx, host)
			if err != nil {
				return nil, err
			}
		}

		allowPriv := isPrivateAllowed()
		v4 := make([]netip.Addr, 0, len(resolved))
		v6 := make([]netip.Addr, 0, len(resolved))
		for _, addr := range resolved {
			unmapped := addr.Unmap()
			if !(allowPriv || isAddrAllowed(unmapped)) {
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
			return nil, ErrBlockedAddress
		}

		dialFn := opts.Dial
		if dialFn == nil {
			dialFn = defaultDialer.DialContext
		}
		var lastErr error
		for _, addr := range candidates {
			conn, dialErr := dialFn(ctx, network, net.JoinHostPort(addr.String(), port))
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
}

// SafeTransportOptions 防 SSRF HTTP Transport 配置
type SafeTransportOptions struct {
	SafeDialOptions
	TLSHandshakeTimeout   time.Duration
	ResponseHeaderTimeout time.Duration
	MaxIdleConns          int
	MaxIdleConnsPerHost   int
	IdleConnTimeout       time.Duration
}

// NewSafeTransport 构造禁用环境代理并绑定防 SSRF 拨号器的 *http.Transport
func NewSafeTransport(opts SafeTransportOptions) *http.Transport {
	tlsTimeout := opts.TLSHandshakeTimeout
	if tlsTimeout <= 0 {
		tlsTimeout = 5 * time.Second
	}
	respHeaderTimeout := opts.ResponseHeaderTimeout
	if respHeaderTimeout <= 0 {
		respHeaderTimeout = 10 * time.Second
	}
	maxIdle := opts.MaxIdleConns
	if maxIdle <= 0 {
		maxIdle = 10
	}
	idleTimeout := opts.IdleConnTimeout
	if idleTimeout <= 0 {
		idleTimeout = 30 * time.Second
	}
	return &http.Transport{
		Proxy:                 nil, // 不走环境代理，避免代理替我们访问内网
		DialContext:           NewSafeDialContext(opts.SafeDialOptions),
		TLSHandshakeTimeout:   tlsTimeout,
		ResponseHeaderTimeout: respHeaderTimeout,
		MaxIdleConns:          maxIdle,
		MaxIdleConnsPerHost:   opts.MaxIdleConnsPerHost,
		IdleConnTimeout:       idleTimeout,
	}
}

// SafeClientOptions 防 SSRF HTTP 客户端配置
type SafeClientOptions struct {
	SafeTransportOptions
	Timeout       time.Duration
	MaxRedirects  int
	CheckRedirect func(req *http.Request, via []*http.Request) error
}

// NewSafeHTTPClient 构造带重定向校验与防 SSRF 拨号器的 *http.Client
func NewSafeHTTPClient(opts SafeClientOptions) *http.Client {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	maxRedirects := opts.MaxRedirects
	if maxRedirects <= 0 {
		maxRedirects = 3
	}
	allowAddr := opts.AllowAddr
	if allowAddr == nil {
		allowAddr = IsPublicAddr
	}
	checkRedirect := opts.CheckRedirect
	if checkRedirect == nil {
		checkRedirect = func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return errors.New("too many redirects")
			}
			allowPriv := SafeFetchAllowPrivate || (opts.AllowPrivate != nil && opts.AllowPrivate())
			return CheckSafeURL(req.URL, allowPriv, allowAddr)
		}
	}
	return &http.Client{
		Timeout:       timeout,
		Transport:     NewSafeTransport(opts.SafeTransportOptions),
		CheckRedirect: checkRedirect,
	}
}

// CheckSafeURL 校验外部请求 URL 的协议、凭据、主机名与字面量 IP
func CheckSafeURL(u *url.URL, allowPrivate bool, allowAddr func(netip.Addr) bool) error {
	if u == nil {
		return errors.New("only http and https URLs are allowed")
	}
	scheme := strings.ToLower(u.Scheme)
	if !(scheme == "http" || scheme == "https") {
		return errors.New("only http and https URLs are allowed")
	}
	if u.User != nil {
		return errors.New("URLs with credentials are not allowed")
	}
	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	if host == "" {
		return ErrBlockedAddress
	}
	if !allowPrivate {
		if host == "localhost" || strings.HasSuffix(host, ".localhost") {
			return ErrBlockedAddress
		}
		if ip, err := netip.ParseAddr(host); err == nil {
			check := allowAddr
			if check == nil {
				check = IsPublicAddr
			}
			if !check(ip.Unmap()) {
				return ErrBlockedAddress
			}
		}
	}
	return nil
}

func checkFetchURL(u *url.URL) error {
	return CheckSafeURL(u, SafeFetchAllowPrivate, IsPublicAddr)
}

// SafeHTTPClient 默认防 SSRF 的 HTTP 客户端（仅允许 80/443 公网地址）
var SafeHTTPClient = NewSafeHTTPClient(SafeClientOptions{
	Timeout:      15 * time.Second,
	MaxRedirects: 3,
})

// SafeFetchResult 获取到的内容
type SafeFetchResult struct {
	Body        []byte
	ContentType string
	FinalURL    string
	Truncated   bool
}

// SafeFetch 获取外部 URL，最多读取 maxBytes 字节；allowedTypes 非空时只接受这些 Content-Type 前缀
func SafeFetch(ctx context.Context, rawURL string, maxBytes int64, allowedTypes ...string) (*SafeFetchResult, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	if err := checkFetchURL(u); err != nil {
		if errors.Is(err, ErrBlockedAddress) {
			return nil, errors.New("this address is not allowed (private or reserved network)")
		}
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; neo-blog-agent/1.0)")
	resp, err := SafeHTTPClient.Do(req)
	if err != nil {
		if errors.Is(err, ErrBlockedAddress) {
			return nil, errors.New("this address is not allowed (private or reserved network)")
		}
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
	if len(allowedTypes) > 0 {
		ok := false
		for _, t := range allowedTypes {
			if strings.HasPrefix(contentType, t) {
				ok = true
				break
			}
		}
		if !ok {
			return nil, fmt.Errorf("unsupported content type %q", contentType)
		}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	result := &SafeFetchResult{ContentType: contentType, FinalURL: resp.Request.URL.String()}
	if int64(len(body)) > maxBytes {
		body = body[:maxBytes]
		result.Truncated = true
	}
	result.Body = body
	return result, nil
}
