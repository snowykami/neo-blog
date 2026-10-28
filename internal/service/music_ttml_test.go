package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testTTML = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:01.000" end="00:02.000"><span begin="00:01.000" end="00:02.000">hi</span></p></div></body></tt>`

// ttmlServer 按路径返回固定的状态与正文，并统计请求次数
func ttmlServer(t *testing.T, status int, body string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if status >= 300 && status < 400 {
			http.Redirect(w, r, "/elsewhere", status)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

func setupTTMLTest(t *testing.T, customPrefix string, mirrors ...string) {
	t.Helper()
	t.Setenv("MUSIC_TTML_URL_PREFIX", customPrefix)
	original := musicTTMLMirrors
	musicTTMLMirrors = mirrors
	musicTTMLCache.Clear()
	t.Cleanup(func() {
		musicTTMLMirrors = original
		musicTTMLCache.Clear()
	})
}

func TestTTMLLyricPriority(t *testing.T) {
	custom, _ := ttmlServer(t, http.StatusOK, strings.Replace(testTTML, "hi", "custom", 1))
	amll, _ := ttmlServer(t, http.StatusOK, testTTML)
	setupTTMLTest(t, custom.URL+"/", amll.URL)
	s := NewMusicService()

	// 自定义源优先
	got, svcerr := s.GetTTMLLyric(context.Background(), 1, "")
	if svcerr != nil || got.Source != musicTTMLSourceCustom || !strings.Contains(got.TTML, "custom") {
		t.Fatalf("auto = %+v, %v", got, svcerr)
	}
	// 手动切换：只取 AMLL
	got, svcerr = s.GetTTMLLyric(context.Background(), 1, musicTTMLSourceAMLL)
	if svcerr != nil || got.Source != musicTTMLSourceAMLL {
		t.Fatalf("amll = %+v, %v", got, svcerr)
	}
	if _, svcerr = s.GetTTMLLyric(context.Background(), 1, "qq"); svcerr == nil || svcerr.Code != http.StatusBadRequest {
		t.Fatalf("unknown source should be rejected, got %v", svcerr)
	}
}

func TestCustomTTMLURL(t *testing.T) {
	for _, item := range []struct{ config, want string }{
		{"", ""},
		{"https://cdn.example.com/lyrics/", "https://cdn.example.com/lyrics/42.ttml"},
		{"https://cdn.example.com/lyrics/{id}.ttml", "https://cdn.example.com/lyrics/42.ttml"},
		{"https://example.com/ttml?id={id}&format=ttml", "https://example.com/ttml?id=42&format=ttml"},
		{"ftp://example.com/{id}.ttml", ""},
		{"/lyrics/{id}.ttml", ""},
	} {
		t.Setenv("MUSIC_TTML_URL_PREFIX", item.config)
		if got := customTTMLURL(42); got != item.want {
			t.Errorf("%q: got %q, want %q", item.config, got, item.want)
		}
	}
}

func TestTTMLLyricCustomTemplate(t *testing.T) {
	var requested string
	custom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = r.URL.RequestURI()
		_, _ = w.Write([]byte(testTTML))
	}))
	t.Cleanup(custom.Close)
	amll, _ := ttmlServer(t, http.StatusNotFound, "")
	setupTTMLTest(t, custom.URL+"/music/lyrics/{id}.ttml", amll.URL)

	got, svcerr := NewMusicService().GetTTMLLyric(context.Background(), 7, "")
	if svcerr != nil || got.Source != musicTTMLSourceCustom || requested != "/music/lyrics/7.ttml" {
		t.Fatalf("got %+v, %v, requested %q", got, svcerr, requested)
	}
}

func TestTTMLLyricMirrors(t *testing.T) {
	custom, _ := ttmlServer(t, http.StatusNotFound, "")
	failing, _ := ttmlServer(t, http.StatusInternalServerError, "")
	missing, _ := ttmlServer(t, http.StatusNotFound, "")
	hit, _ := ttmlServer(t, http.StatusOK, testTTML)
	setupTTMLTest(t, custom.URL, failing.URL, missing.URL, hit.URL)

	// 自定义源没有、部分镜像出错或没有：仍取到命中的镜像
	got, svcerr := NewMusicService().GetTTMLLyric(context.Background(), 2, "")
	if svcerr != nil || got.Source != musicTTMLSourceAMLL {
		t.Fatalf("got %+v, %v", got, svcerr)
	}
}

func TestTTMLLyricMissCache(t *testing.T) {
	redirect, redirectCalls := ttmlServer(t, http.StatusFound, "")
	html, htmlCalls := ttmlServer(t, http.StatusOK, "<!doctype html><html></html>")
	setupTTMLTest(t, "", redirect.URL, html.URL)
	s := NewMusicService()

	// 重定向与非 TTML 正文都是确定未命中：返回 404，并在负缓存有效期内不再请求
	for range 2 {
		if _, svcerr := s.GetTTMLLyric(context.Background(), 3, ""); svcerr == nil || svcerr.Code != http.StatusNotFound {
			t.Fatalf("expected not found, got %v", svcerr)
		}
	}
	if redirectCalls.Load() != 1 || htmlCalls.Load() != 1 {
		t.Fatalf("definite misses should be cached, calls = %d, %d", redirectCalls.Load(), htmlCalls.Load())
	}
}

func TestTTMLLyricMissQuorum(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(3 * time.Second):
		}
		http.Redirect(w, r, "/elsewhere", http.StatusFound)
	}))
	t.Cleanup(slow.Close)
	first, _ := ttmlServer(t, http.StatusNotFound, "")
	second, _ := ttmlServer(t, http.StatusNotFound, "")
	setupTTMLTest(t, "", slow.URL, first.URL, second.URL)

	// 两个镜像确定未命中即断定没有，不等很慢才返回的镜像
	start := time.Now()
	if _, svcerr := NewMusicService().GetTTMLLyric(context.Background(), 5, ""); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("expected not found, got %v", svcerr)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("should not wait for the slow mirror, took %v", elapsed)
	}
}

func TestTTMLLyricErrorsNotCached(t *testing.T) {
	failing, calls := ttmlServer(t, http.StatusBadGateway, "")
	missing, _ := ttmlServer(t, http.StatusNotFound, "")
	setupTTMLTest(t, "", failing.URL, missing.URL)
	s := NewMusicService()

	// 有镜像出错时不能断定没有：不缓存，下次重新请求
	for range 2 {
		if _, svcerr := s.GetTTMLLyric(context.Background(), 4, ""); svcerr == nil {
			t.Fatal("expected not found")
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("errors must not be cached, calls = %d", calls.Load())
	}
}

func TestIsTTMLDocument(t *testing.T) {
	cases := map[string]bool{
		testTTML:                           true,
		"\xef\xbb\xbf  " + testTTML:        true,
		"<html><body>404</body></html>":    false,
		"<tt><p>unclosed</tt>":             false,
		"not xml":                          false,
		`{"code":200}`:                     false,
		"<?xml version=\"1.0\"?><tt></tt>": true,
	}
	for input, want := range cases {
		if got := isTTMLDocument([]byte(input)); got != want {
			t.Errorf("isTTMLDocument(%q) = %v, want %v", input, got, want)
		}
	}
}
