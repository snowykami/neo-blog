package service

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"golang.org/x/text/encoding/simplifiedchinese"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestLinkPreviewAllowedAddr(t *testing.T) {
	allowed := []string{
		"1.1.1.1",
		"8.8.8.8",
		"2606:4700:4700::1111",
		"198.18.0.1",    // Clash / Surge Fake-IP v4
		"198.19.255.10", // Fake-IP v4 上界内
		"fc00::1",       // Clash / Sing-box Fake-IP v6
		"fc00:3fff::1",
		"::ffff:198.18.0.2",
	}
	for _, raw := range allowed {
		addr := netip.MustParseAddr(raw)
		if !IsLinkPreviewAllowedAddr(addr) {
			t.Errorf("expected %s to be allowed", raw)
		}
	}

	blocked := []string{
		"0.0.0.0",
		"127.0.0.1",
		"10.0.0.1",
		"172.16.5.4",
		"192.168.1.1",
		"169.254.169.254", // 云元数据
		"100.100.100.200", // 阿里云元数据（CGNAT）
		"::1",
		"::",
		"fe80::1",
		"fd00:ec2::254", // AWS IPv6 元数据
		"fc40::1",       // 超出 fc00::/18 的 ULA
		"fd12:3456::1",
		"::ffff:127.0.0.1",
	}
	for _, raw := range blocked {
		addr := netip.MustParseAddr(raw)
		if IsLinkPreviewAllowedAddr(addr) {
			t.Errorf("expected %s to be blocked", raw)
		}
	}
}

func TestLinkPreviewNormalizeAndExtract(t *testing.T) {
	htmlContent := `
		<p><a href="HTTPS://GitHub.com:443/snowykami/neo-blog">repo</a></p>
		<p><a href="https://example.com">root</a></p>
		<p><a href="https://example.com/%e4%b8%ad%e6%96%87">cn</a></p>
		<div data-component="linkCard" data-version="1" data-props="{&quot;url&quot;:&quot;https://wompa.land/articles/iterm-status-bar&quot;}"></div>
		<p><a href="/p/internal">internal</a></p>
		<p><a href="javascript:alert(1)">bad</a></p>
	`
	set := ExtractContentExternalURLs(htmlContent)
	for _, raw := range []string{
		"https://github.com/snowykami/neo-blog",
		"https://example.com/",
		"https://example.com/%E4%B8%AD%E6%96%87",
		"https://wompa.land/articles/iterm-status-bar",
	} {
		norm, _, err := NormalizeLinkPreviewURL(raw)
		if err != nil {
			t.Fatalf("normalize %s: %v", raw, err)
		}
		if _, ok := set[norm]; !ok {
			t.Errorf("expected %s (normalized %s) in extracted set %v", raw, norm, set)
		}
	}
	if len(set) != 4 {
		t.Errorf("expected 4 external URLs, got %d: %v", len(set), set)
	}
}

func TestLinkPreviewResolveFetchURL(t *testing.T) {
	_, u, err := NormalizeLinkPreviewURL("https://music.163.com/#/song?id=1487502645")
	if err != nil {
		t.Fatal(err)
	}
	got := resolvePreviewFetchURL(u).String()
	if got != "https://music.163.com/song?id=1487502645" {
		t.Fatalf("unexpected rewritten url: %s", got)
	}

	// 防跨站跳转：#//evil.example 不得改写到其他域名
	_, evil, _ := NormalizeLinkPreviewURL("https://music.163.com/#//evil.example/x")
	if resolvePreviewFetchURL(evil).Hostname() != "music.163.com" {
		t.Fatalf("cross-origin hash rewrite leaked: %s", resolvePreviewFetchURL(evil))
	}
}

func TestLinkPreviewMetadataDecoding(t *testing.T) {
	gbkDoc, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte(
		`<html><head><meta charset="gbk"><title>中文旧站标题</title><meta property="og:description" content="简介内容"><meta property="og:image" content="/cover.png"><link rel="shortcut icon" href="icon.svg"></head><body>` + strings.Repeat("x", 4096) + `</body></html>`,
	))
	if err != nil {
		t.Fatal(err)
	}

	var gz bytes.Buffer
	gw := gzip.NewWriter(&gz)
	_, _ = gw.Write(gbkDoc)
	_ = gw.Close()

	headBytes, err := readPreviewHead(bytes.NewReader(gz.Bytes()), "gzip", linkPreviewMaxBytes, true)
	if err != nil {
		t.Fatalf("readPreviewHead: %v", err)
	}
	decoded := decodePreviewHTML(headBytes, "text/html")
	base, _ := url.Parse("https://old.example.com/dir/page.html")
	meta := extractHTMLPreviewMetadata(decoded, base, "https://old.example.com/dir/page.html")
	if meta.Title != "中文旧站标题" {
		t.Errorf("got title %q, want 中文旧站标题", meta.Title)
	}
	if meta.Description != "简介内容" {
		t.Errorf("got desc %q, want 简介内容", meta.Description)
	}
	if meta.Image != "https://old.example.com/cover.png" {
		t.Errorf("got image %q", meta.Image)
	}
	if meta.Favicon != "https://old.example.com/dir/icon.svg" {
		t.Errorf("got favicon %q", meta.Favicon)
	}
}

func TestLinkPreviewWhitelistAndCaching(t *testing.T) {
	sharedstate.UseMemory()
	urlSetMemCache.Lock()
	urlSetMemCache.entries = make(map[string]map[string]struct{})
	urlSetMemCache.Unlock()

	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init db: %v", err)
	}

	var upstreamHits atomic.Int32
	var receivedUA atomic.Value
	origRT := linkPreviewRoundTripper
	defer func() { linkPreviewRoundTripper = origRT }()
	linkPreviewRoundTripper = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		upstreamHits.Add(1)
		receivedUA.Store(req.Header.Get("User-Agent"))
		body := `<html><head><meta property="og:title" content="Hello Blog"><meta name="description" content="Preview Desc"></head><body>ok</body></html>`
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
			Body:       io.NopCloser(strings.NewReader(body)),
			Request:    req,
		}, nil
	})

	editor := &model.User{Username: "ed", Email: "ed@test.local", Role: constant.RoleEditor}
	normalUser := &model.User{Username: "usr", Email: "usr@test.local", Role: constant.RoleUser}
	if err := repo.GetDB().Create(editor).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.GetDB().Create(normalUser).Error; err != nil {
		t.Fatal(err)
	}
	editorCtx := context.WithValue(context.Background(), "user_id", editor.ID)
	userCtx := context.WithValue(context.Background(), "user_id", normalUser.ID)
	anonCtx := context.Background()

	const baseURL = "https://blog-target.example.com"
	targetURL := baseURL + "/article-1"
	draftOnlyURL := baseURL + "/draft-only"
	privateURL := baseURL + "/secret-link"
	sidebarURL := baseURL + "/sidebar-link"
	unsavedURL := baseURL + "/editor-unsaved"

	draftHTML := `<p><a href="` + draftOnlyURL + `">draft</a></p>`
	pubPost := &model.Post{
		UserID: editor.ID,
		PostBase: model.PostBase{
			Title:        "pub",
			Content:      `<p>正文 <a href="` + targetURL + `">链接</a></p>`,
			DraftContent: &draftHTML,
			IsPrivate:    false,
		},
	}
	privPost := &model.Post{
		UserID: editor.ID,
		PostBase: model.PostBase{
			Title:     "priv",
			Content:   `<p><a href="` + privateURL + `">secret</a></p>`,
			IsPrivate: true,
		},
	}
	pubPage := &model.Page{
		UserID: editor.ID,
		PageBase: model.PageBase{
			Title:     "about",
			Slug:      "about",
			Kind:      model.PageKindContent,
			Content:   `<div data-component="linkCard" data-props="{&quot;url&quot;:&quot;` + baseURL + `/page-card&quot;}"></div>`,
			IsPrivate: false,
		},
	}
	if err := repo.GetDB().Create(pubPost).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.GetDB().Create(privPost).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.GetDB().Create(pubPage).Error; err != nil {
		t.Fatal(err)
	}
	_ = repo.KV.SetKV("sidebar_cards", []map[string]any{
		{"type": "component", "name": "linkCard", "props": map[string]any{"url": sidebarURL}},
	})

	svc := NewLinkPreviewService()

	// 1. 匿名访客访问公开文章中的外链：成功且命中缓存
	got, pubCache, svcerr := svc.Get(anonCtx, &dto.LinkPreviewReq{
		URL:        targetURL,
		TargetType: constant.TargetTypePost,
		TargetID:   pubPost.ID,
	}, "zh-CN,zh;q=0.9")
	if svcerr != nil {
		t.Fatalf("anon public post preview failed: %v", svcerr)
	}
	if !pubCache || got.Title != "Hello Blog" || got.Description != "Preview Desc" {
		t.Fatalf("unexpected preview: %+v pubCache=%v", got, pubCache)
	}
	if ua, _ := receivedUA.Load().(string); !strings.Contains(ua, "Chrome/") {
		t.Fatalf("expected normal browser UA, got %q", ua)
	}
	if hits := upstreamHits.Load(); hits != 1 {
		t.Fatalf("expected 1 upstream hit, got %d", hits)
	}

	// 再次请求同一 URL：直接命中 sharedstate 缓存，不再访问上游
	if _, _, svcerr := svc.Get(anonCtx, &dto.LinkPreviewReq{
		URL:        targetURL,
		TargetType: constant.TargetTypePost,
		TargetID:   pubPost.ID,
	}, "zh-CN"); svcerr != nil {
		t.Fatalf("second preview failed: %v", svcerr)
	}
	if hits := upstreamHits.Load(); hits != 1 {
		t.Fatalf("expected cache hit (still 1 upstream hit), got %d", hits)
	}

	// 2. 匿名访客与普通用户不能请求不在文章中的 URL、草稿未发布 URL、私密文章 URL，也不能不传 target_type
	deniedCases := []*dto.LinkPreviewReq{
		{URL: targetURL},
		{URL: unsavedURL, TargetType: constant.TargetTypePost, TargetID: pubPost.ID},
		{URL: draftOnlyURL, TargetType: constant.TargetTypePost, TargetID: pubPost.ID},
		{URL: privateURL, TargetType: constant.TargetTypePost, TargetID: privPost.ID},
	}
	for _, tc := range deniedCases {
		for _, ctx := range []context.Context{anonCtx, userCtx} {
			if _, _, err := svc.Get(ctx, tc, "zh-CN"); err == nil || err.Code != http.StatusForbidden {
				t.Errorf("expected 403 for req=%+v, got %v", tc, err)
			}
		}
	}

	// 3. 公开独立页面与侧边栏中的 linkCard 对匿名访客同样可用
	if _, _, err := svc.Get(anonCtx, &dto.LinkPreviewReq{
		URL:        baseURL + "/page-card",
		TargetType: constant.TargetTypePage,
		TargetID:   pubPage.ID,
	}, "zh-CN"); err != nil {
		t.Fatalf("anon public page linkCard failed: %v", err)
	}
	if _, _, err := svc.Get(anonCtx, &dto.LinkPreviewReq{
		URL:        sidebarURL,
		TargetType: TargetTypeSidebar,
	}, "zh-CN"); err != nil {
		t.Fatalf("anon sidebar linkCard failed: %v", err)
	}

	// 4. 编辑者在后台编辑器可直接预览尚未保存的外链（私有缓存）
	_, editorPubCache, err := svc.Get(editorCtx, &dto.LinkPreviewReq{URL: unsavedURL}, "zh-CN")
	if err != nil {
		t.Fatalf("editor unsaved preview failed: %v", err)
	}
	if editorPubCache {
		t.Fatalf("editor-only preview must not be marked publicly cacheable")
	}
}

func TestLinkPreviewDualStackSkipsBlockedAddr(t *testing.T) {
	origLookup := linkPreviewLookupNetIP
	origDial := linkPreviewDial
	origAllow := linkPreviewAllowPrivate
	defer func() {
		linkPreviewLookupNetIP = origLookup
		linkPreviewDial = origDial
		linkPreviewAllowPrivate = origAllow
	}()
	linkPreviewAllowPrivate = false

	// 情况 1：双栈解析里混有受限 IPv6（::1 / fd00::1）与合法 Fake-IP（198.18.0.8），应跳过受限地址并连向合法地址
	var dialedAddr string
	linkPreviewLookupNetIP = func(ctx context.Context, host string) ([]netip.Addr, error) {
		return []netip.Addr{
			netip.MustParseAddr("::1"),
			netip.MustParseAddr("fd00:ec2::254"),
			netip.MustParseAddr("198.18.0.8"),
		}, nil
	}
	linkPreviewDial = func(ctx context.Context, network, address string) (net.Conn, error) {
		dialedAddr = address
		c1, c2 := net.Pipe()
		_ = c2.Close()
		return c1, nil
	}
	conn, err := linkPreviewDialContext(context.Background(), "tcp", "dual.example.com:443")
	if err != nil {
		t.Fatalf("expected dual-stack dial to succeed with allowed Fake-IP, got %v", err)
	}
	_ = conn.Close()
	if dialedAddr != "198.18.0.8:443" {
		t.Fatalf("expected dial to 198.18.0.8:443, got %s", dialedAddr)
	}

	// 情况 2：全部地址均受限时返回 errLinkPreviewBlockedAddr
	linkPreviewLookupNetIP = func(ctx context.Context, host string) ([]netip.Addr, error) {
		return []netip.Addr{
			netip.MustParseAddr("::1"),
			netip.MustParseAddr("fe80::1"),
		}, nil
	}
	if _, err := linkPreviewDialContext(context.Background(), "tcp", "blocked.example.com:443"); err != errLinkPreviewBlockedAddr {
		t.Fatalf("expected all-blocked addresses to fail with errLinkPreviewBlockedAddr, got %v", err)
	}
}
