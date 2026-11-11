package utils

import "testing"

func TestParseUA(t *testing.T) {
	cases := []struct {
		ua                         string
		os, osVer, browser, device string
	}{
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "macOS", "10.15.7", "Edge", DeviceDesktop},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "Windows", "10.0", "Chrome", DeviceDesktop},
		{"Mozilla/5.0 (Linux; Android 14; 23013RK75C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "Android", "14", "Chrome", DeviceMobile},
		{"Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Android", "13", "Chrome", DeviceTablet},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "iOS", "18.1", "Safari", DeviceMobile},
		{"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "iPadOS", "17.0", "Safari", DeviceTablet},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800322d) NetType/WIFI Language/zh_CN", "iOS", "17.5", "WeChat", DeviceMobile},
		{"Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Linux", "", "Firefox", DeviceDesktop},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0", "Windows", "10.0", "Opera", DeviceDesktop},
		{"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "", "", "", DeviceBot},
	}
	for _, c := range cases {
		r := ParseUA(c.ua)
		if r.OS != c.os || r.OSVersion != c.osVer || r.Browser != c.browser || r.DeviceType != c.device {
			t.Errorf("ParseUA(%q)\n got  %+v\n want os=%s ver=%s browser=%s device=%s", c.ua, r, c.os, c.osVer, c.browser, c.device)
		}
	}
}

func TestPublicOSAndBrowser(t *testing.T) {
	cases := []struct {
		ua, os, browser string
	}{
		// macOS 版本被固定为 10.15.7，只显示系统名
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36", "macOS", "Chrome 157"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0", "macOS", "Firefox 131"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15", "macOS 10.14.6", "Safari 14.1.2"},
		// Windows 10 与 11 都是 NT 10.0；更早的版本换成发行名
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "Windows", "Chrome 141"},
		{"Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36", "Windows 7", "Chrome 109"},
		// Chrome 精简 UA 的 Android 固定为 10; K
		{"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", "Android", "Chrome 141"},
		{"Mozilla/5.0 (Linux; Android 14; 23013RK75C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "Android 14", "Chrome 120"},
		// iOS 26 起系统版本固定报 18.6
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1", "iOS", "Safari 26"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800322d) NetType/WIFI Language/zh_CN", "iOS 17.5", "WeChat 8.0.50"},
		{"Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Linux", "Firefox 131"},
		{"", "", ""},
	}
	for _, c := range cases {
		r := ParseUA(c.ua)
		if got := r.PublicOS(); got != c.os {
			t.Errorf("PublicOS(%q) = %q, want %q", c.ua, got, c.os)
		}
		if got := r.PublicBrowser(); got != c.browser {
			t.Errorf("PublicBrowser(%q) = %q, want %q", c.ua, got, c.browser)
		}
	}
}
