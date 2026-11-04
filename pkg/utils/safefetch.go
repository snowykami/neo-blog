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

// 安全获取外部资源（防 SSRF）：只允许 http(s) 与 80 / 443 端口，解析出的每个地址（包括每一跳重定向）都必须是公网地址

// SafeFetchAllowPrivate 测试中访问本机测试服务器时打开，生产环境不得修改
var SafeFetchAllowPrivate = false

var errBlockedAddress = errors.New("blocked address")

// blockedPrefixes 不属于 netip 内置判断、但同样不应访问的网段
var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),  // 运营商级 NAT
	netip.MustParsePrefix("192.0.0.0/24"),   // IETF 协议分配
	netip.MustParsePrefix("198.18.0.0/15"),  // 基准测试
	netip.MustParsePrefix("240.0.0.0/4"),    // 保留
	netip.MustParsePrefix("64:ff9b::/96"),   // NAT64，可映射到内网 IPv4
	netip.MustParsePrefix("2002::/16"),      // 6to4
	netip.MustParsePrefix("fec0::/10"),      // 已废弃的站点本地地址
	netip.MustParsePrefix("0.0.0.0/8"),      // 本网络
	netip.MustParsePrefix("192.88.99.0/24"), // 6to4 中继
}

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

var safeDialer = &net.Dialer{
	Timeout: 5 * time.Second,
	// 在真正建立连接前检查解析后的地址，防止 DNS 重绑定绕过
	Control: func(network, address string, _ syscall.RawConn) error {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		if !(port == "80" || port == "443") && !SafeFetchAllowPrivate {
			return errBlockedAddress
		}
		addr, err := netip.ParseAddr(host)
		if err != nil {
			return err
		}
		if !(SafeFetchAllowPrivate || IsPublicAddr(addr)) {
			return errBlockedAddress
		}
		return nil
	},
}

// SafeHTTPClient 防 SSRF 的 HTTP 客户端
var SafeHTTPClient = &http.Client{
	Timeout: 15 * time.Second,
	Transport: &http.Transport{
		Proxy:                 nil, // 不走环境代理，避免代理替我们访问内网
		DialContext:           safeDialer.DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		MaxIdleConns:          10,
		IdleConnTimeout:       30 * time.Second,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("too many redirects")
		}
		return checkFetchURL(req.URL)
	},
}

func checkFetchURL(u *url.URL) error {
	if u == nil || !(u.Scheme == "http" || u.Scheme == "https") {
		return errors.New("only http and https URLs are allowed")
	}
	host := u.Hostname()
	if host == "" || strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") {
		if !SafeFetchAllowPrivate {
			return errBlockedAddress
		}
	}
	if u.User != nil {
		return errors.New("URLs with credentials are not allowed")
	}
	return nil
}

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
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; neo-blog-agent/1.0)")
	resp, err := SafeHTTPClient.Do(req)
	if err != nil {
		if errors.Is(err, errBlockedAddress) {
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
