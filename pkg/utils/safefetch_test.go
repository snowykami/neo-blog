package utils

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"testing"
)

func TestSafeFetchAddressChecks(t *testing.T) {
	public := []string{"1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"}
	for _, raw := range public {
		addr := netip.MustParseAddr(raw)
		if !IsPublicAddr(addr) {
			t.Errorf("expected %s to be public", raw)
		}
		if !IsPublicOrFakeIPAddr(addr) {
			t.Errorf("expected %s to be allowed by IsPublicOrFakeIPAddr", raw)
		}
	}

	fakeIPs := []string{"198.18.0.1", "198.19.255.254", "fc00::1", "fc00:3fff::1"}
	for _, raw := range fakeIPs {
		addr := netip.MustParseAddr(raw)
		if IsPublicAddr(addr) {
			t.Errorf("expected Fake-IP %s to be blocked by strict IsPublicAddr", raw)
		}
		if !IsPublicOrFakeIPAddr(addr) {
			t.Errorf("expected Fake-IP %s to be allowed by IsPublicOrFakeIPAddr", raw)
		}
	}

	blocked := []string{
		"0.0.0.0", "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1",
		"169.254.169.254", "100.100.100.200", "192.0.2.1", "203.0.113.5",
		"::1", "::", "fe80::1", "fd00:ec2::254", "fc40::1", "2001:db8::1", "64:ff9b::127.0.0.1",
	}
	for _, raw := range blocked {
		addr := netip.MustParseAddr(raw)
		if IsPublicAddr(addr) || IsPublicOrFakeIPAddr(addr) {
			t.Errorf("expected %s to be blocked", raw)
		}
	}
}

func TestNewSafeDialContextDualStackAndPortPolicy(t *testing.T) {
	var dialed string
	dialCtx := NewSafeDialContext(SafeDialOptions{
		AllowAnyPort: false,
		LookupNetIP: func(ctx context.Context, host string) ([]netip.Addr, error) {
			return []netip.Addr{
				netip.MustParseAddr("::1"),
				netip.MustParseAddr("2606:4700:4700::1111"),
				netip.MustParseAddr("1.1.1.1"),
			}, nil
		},
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			dialed = address
			c1, c2 := net.Pipe()
			_ = c2.Close()
			return c1, nil
		},
	})

	// 非 80/443 端口在默认策略下拦截
	if _, err := dialCtx(context.Background(), "tcp", "example.com:8080"); !errors.Is(err, ErrBlockedAddress) {
		t.Fatalf("expected port 8080 to be blocked, got %v", err)
	}

	// 双栈解析自动过滤 ::1 且优先拨号合法 IPv4
	conn, err := dialCtx(context.Background(), "tcp", "example.com:443")
	if err != nil {
		t.Fatalf("expected dial to succeed, got %v", err)
	}
	_ = conn.Close()
	if dialed != "1.1.1.1:443" {
		t.Fatalf("expected IPv4-first dial 1.1.1.1:443, got %s", dialed)
	}

	// CheckSafeURL 校验协议、凭据与本地主机名
	for _, bad := range []string{
		"ftp://example.com/a",
		"http://user:pass@example.com/",
		"http://localhost/admin",
		"http://sub.localhost/admin",
		"http://169.254.169.254/latest/meta-data/",
	} {
		u, _ := url.Parse(bad)
		if err := CheckSafeURL(u, false, IsPublicAddr); err == nil {
			t.Errorf("expected CheckSafeURL(%q) to fail", bad)
		}
	}
}
