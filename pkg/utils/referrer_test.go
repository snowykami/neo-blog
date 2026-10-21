package utils

import "testing"

func TestClassifyReferrer(t *testing.T) {
	site := "blog.sfkm.me"
	cases := []struct {
		referrer, path string
		source, host   string
	}{
		{"https://www.google.com/", "/p/1", "google", "google.com"},
		{"https://www.google.com.hk/", "/p/1", "google", "google.com.hk"},
		{"https://cn.bing.com/search?q=neo", "/p/1", "bing", "cn.bing.com"},
		{"https://github.com/snowykami/neo-blog", "/", "github", "github.com"},
		{"https://snowykami.github.io/", "/", "external", "snowykami.github.io"},
		{"https://t.co/abc", "/", "twitter", "t.co"},
		{"https://chatgpt.com/", "/p/2", "chatgpt", "chatgpt.com"},
		{"https://friend-blog.example.org/links", "/", "external", "friend-blog.example.org"},
		{"https://blog.sfkm.me/a", "/p/1", "internal", "blog.sfkm.me"},
		{"https://www.blog.sfkm.me:443/a", "/p/1", "internal", "blog.sfkm.me"},
		{"", "/p/1", "direct", ""},
		{"android-app://com.tencent.mm/", "/p/1", "direct", ""},
		{"", "/p/1?utm_source=github", "github", ""},
		{"", "/p/1?utm_source=newsletter", "external", "newsletter"},
		{"", "/p/1?ref=v2ex.com", "v2ex", "v2ex.com"},
		{"https://blog.sfkm.me/", "/p/1?utm_source=weibo", "weibo", ""},
	}
	for _, c := range cases {
		source, host := ClassifyReferrer(c.referrer, c.path, site)
		if source != c.source || host != c.host {
			t.Errorf("ClassifyReferrer(%q, %q) = (%q, %q), want (%q, %q)", c.referrer, c.path, source, host, c.source, c.host)
		}
	}
}

func TestTruncate(t *testing.T) {
	if got := Truncate("中文abc", 4); got != "中" {
		t.Errorf("Truncate should not split multi-byte runes, got %q", got)
	}
}
