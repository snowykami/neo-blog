package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
)

func htmlResp(status int, ct string, body string, req *http.Request) *http.Response {
	if ct == "" {
		ct = "text/html; charset=utf-8"
	}
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{ct}},
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}

func TestFriendDiscoveryFunnelAndAIFallback(t *testing.T) {
	alice, _, _, admin := setupFriendTest(t)
	svc := NewFriendService()

	if err := repo.KV.SetKV("base_url", "https://myblog.example.org"); err != nil {
		t.Fatalf("set base_url: %v", err)
	}

	// 启动本地 Mock OpenAI 兼容服务，用于验证常规代码检测不到时的第 4 层 AI 辅助发现
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bodyBytes, _ := io.ReadAll(r.Body)
		promptText := string(bodyBytes)
		w.Header().Set("Content-Type", "application/json")

		var content string
		if strings.Contains(promptText, "site_discovery_context") {
			// 同时返回一个有效创意路由与一个返回 HTML 的假 Feed，验证后端必定二次实测校验 AI 输出
			content = `{"rss_candidates":["https://creative.example.com/fake-html-feed","https://creative.example.com/dianbo-xml"],"backlink_candidates":["https://evil.other.com/steal","https://creative.example.com/chuanmen"]}`
		} else if strings.Contains(promptText, "site_metadata") {
			content = `{"name":"Creative Indie","description":"独立创作空间","color_key":"violet","rss_candidate":"https://creative.example.com/dianbo-xml","backlink_candidate":"https://creative.example.com/chuanmen"}`
		} else {
			content = `{"verdict":"approved","reason":"内容正常且反链已核验"}`
		}

		respPayload := map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"content": content}},
			},
		}
		_ = json.NewEncoder(w).Encode(respPayload)
	}))
	t.Cleanup(aiServer.Close)

	origRT := friendOutboundRoundTripper
	friendOutboundRoundTripper = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		host := req.URL.Hostname()
		p := req.URL.Path

		switch host {
		// 场景 1：SPA 站点对未知路径一律返回 200 HTML（防假阳性），真实 RSS 为 Hugo /index.xml，友链在 Hexo Butterfly 风格的 /link
		case "hugo-spa.example.com":
			switch p {
			case "/index.xml":
				return htmlResp(200, "application/rss+xml", `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Hugo</title></channel></rss>`, req), nil
			case "/link":
				return htmlResp(200, "text/html", `<html><body><a href="https://myblog.example.org">My Blog</a></body></html>`, req), nil
			default:
				// SPA fallback：即使 /feed.xml 返回 200 HTML，也绝不能被误判为有效 RSS
				return htmlResp(200, "text/html", `<!DOCTYPE html><html><head><title>Hugo SPA</title></head><body>app shell</body></html>`, req), nil
			}

		// 场景 2：多语言前缀友链页藏在 Sitemap Index -> page-sitemap.xml 中，且首页 <head> 声明指向同根域 api 子域名的 Atom Feed（如 Mix-Space）
		case "sitemap-blog.example.com":
			switch p {
			case "/", "":
				return htmlResp(200, "text/html", `<html><head><title>Sitemap Blog</title><link rel="alternate" type="application/atom+xml" href="https://api.example.com/feed" /></head><body>Hello</body></html>`, req), nil
			case "/sitemap.xml":
				return htmlResp(404, "text/plain", "not found", req), nil
			case "/sitemap-index.xml":
				return htmlResp(200, "application/xml", `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://sitemap-blog.example.com/post-sitemap.xml</loc></sitemap><sitemap><loc>https://sitemap-blog.example.com/page-sitemap.xml</loc></sitemap></sitemapindex>`, req), nil
			case "/page-sitemap.xml":
				return htmlResp(200, "application/xml", `<?xml version="1.0"?><urlset><url><loc>https://sitemap-blog.example.com/zh-cn/friends/</loc></url></urlset>`, req), nil
			case "/zh-cn/friends/":
				return htmlResp(200, "text/html", `<html><body><a href="https://www.myblog.example.org/">Backlink</a></body></html>`, req), nil
			default:
				return htmlResp(404, "text/plain", "404", req), nil
			}
		case "api.example.com":
			if p == "/feed" {
				return htmlResp(200, "application/atom+xml", `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>MixSpace</title></feed>`, req), nil
			}
			return htmlResp(404, "text/plain", "404", req), nil

		// 场景 3：个性化路由（导航叫「串门」/chuanmen，订阅叫「电波」/dianbo-xml），常规三层规则均无法命中，需走第 4 层 AI 辅助发现并实测验证
		case "creative.example.com":
			switch p {
			case "/", "":
				return htmlResp(200, "text/html", `<html><head><title>Creative Indie - 首页</title><meta name="description" content="Indie notes"/></head><body><nav><a href="/chuanmen">串门</a><a href="/dianbo-xml">电波推送</a></nav></body></html>`, req), nil
			case "/fake-html-feed":
				return htmlResp(200, "text/html", `<!doctype html><html><body>not a feed</body></html>`, req), nil
			case "/dianbo-xml":
				return htmlResp(200, "application/json", `{"version":"https://jsonfeed.org/version/1.1","title":"Creative","items":[]}`, req), nil
			case "/chuanmen":
				return htmlResp(200, "text/html", `<html><body><div><a href="https://myblog.example.org">友站</a></div></body></html>`, req), nil
			default:
				return htmlResp(404, "text/plain", "404", req), nil
			}
		}
		return htmlResp(404, "text/plain", "404", req), nil
	})
	t.Cleanup(func() {
		friendOutboundRoundTripper = origRT
	})

	// 验证 Public Suffix 隔离：alice.github.io 与 bob.github.io 绝不视为同站家族，而 blog.example.com 与 api.example.com 视为同家族
	if sameFriendSiteFamily("alice.github.io", "bob.github.io") {
		t.Fatalf("alice.github.io and bob.github.io must NOT share site family")
	}
	if !sameFriendSiteFamily("sitemap-blog.example.com", "api.example.com") {
		t.Fatalf("expected subdomains under example.com to share site family")
	}

	pub, svcerr := svc.ListPublicFriends(context.Background(), "")
	if svcerr != nil || len(pub.Groups) == 0 {
		t.Fatalf("list groups: %v", svcerr)
	}
	// 选择需要检查反链的默认分组（friends）
	groupID := pub.Groups[0].ID

	// 测试 1：SPA 防假阳性 + /index.xml 与 /link 兜底探测 + 留空自动回填
	link1, svcerr := svc.AdminCreateLink(userCtx(admin), &dto.AdminUpsertFriendLinkReq{
		GroupID:  groupID,
		Name:     "Hugo SPA",
		URL:      "https://hugo-spa.example.com",
		Avatar:   "https://hugo-spa.example.com/favicon.ico",
		ColorKey: "sky",
		Status:   model.FriendStatusApproved,
	})
	if svcerr != nil {
		t.Fatalf("create link1: %v", svcerr)
	}
	WaitForFriendBackgroundTasks()

	probed1, svcerr := svc.AdminProbeLink(userCtx(admin), link1.ID)
	if svcerr != nil {
		t.Fatalf("probe link1: %v", svcerr)
	}
	if probed1.RSSURL != "https://hugo-spa.example.com/index.xml" {
		t.Fatalf("expected SPA false-positives skipped and /index.xml backfilled, got %q", probed1.RSSURL)
	}
	if probed1.BacklinkStatus != model.FriendBacklinkVerified || probed1.BacklinkURL != "https://hugo-spa.example.com/link" {
		t.Fatalf("expected backlink verified & /link backfilled, got status=%q url=%q", probed1.BacklinkStatus, probed1.BacklinkURL)
	}

	// 验证非破坏性回填：管理员手动指定自定义 RSS 后，再次拨测绝不覆盖手动填写的字段
	updatedManual, svcerr := svc.AdminUpdateLink(userCtx(admin), link1.ID, &dto.AdminUpsertFriendLinkReq{
		GroupID:     groupID,
		Name:        "Hugo SPA",
		URL:         "https://hugo-spa.example.com",
		Avatar:      "https://hugo-spa.example.com/favicon.ico",
		RSSURL:      "https://hugo-spa.example.com/custom-manual.xml",
		BacklinkURL: probed1.BacklinkURL,
		ColorKey:    "sky",
		Status:      model.FriendStatusApproved,
	})
	if svcerr != nil {
		t.Fatalf("update manual rss: %v", svcerr)
	}
	WaitForFriendBackgroundTasks()
	reprobed1, _ := svc.AdminProbeLink(userCtx(admin), updatedManual.ID)
	if reprobed1.RSSURL != "https://hugo-spa.example.com/custom-manual.xml" {
		t.Fatalf("manual rss_url was overwritten: got %q", reprobed1.RSSURL)
	}

	// 测试 2：<head> 跨子域 Atom 自发现 + Sitemap Index 展开定位 /zh-cn/friends/
	link2, svcerr := svc.AdminCreateLink(userCtx(admin), &dto.AdminUpsertFriendLinkReq{
		GroupID:  groupID,
		Name:     "Sitemap Blog",
		URL:      "https://sitemap-blog.example.com",
		Avatar:   "https://sitemap-blog.example.com/favicon.ico",
		ColorKey: "mint",
		Status:   model.FriendStatusApproved,
	})
	if svcerr != nil {
		t.Fatalf("create link2: %v", svcerr)
	}
	WaitForFriendBackgroundTasks()
	probed2, svcerr := svc.AdminProbeLink(userCtx(admin), link2.ID)
	if svcerr != nil {
		t.Fatalf("probe link2: %v", svcerr)
	}
	if probed2.RSSURL != "https://api.example.com/feed" {
		t.Fatalf("expected <head> cross-subdomain feed https://api.example.com/feed, got %q", probed2.RSSURL)
	}
	if probed2.BacklinkStatus != model.FriendBacklinkVerified || probed2.BacklinkURL != "https://sitemap-blog.example.com/zh-cn/friends/" {
		t.Fatalf("expected sitemap backlink https://sitemap-blog.example.com/zh-cn/friends/, got status=%q url=%q", probed2.BacklinkStatus, probed2.BacklinkURL)
	}

	// 测试 3：配置平台 AI 后，常规三层代码规则无法识别的创意路由由 AI 辅助发现并经代码校验后回填（含 Autofill 与后台拨测两条路径）
	_ = repo.KV.SetKV("ai_api_base_url", aiServer.URL)
	_ = repo.KV.SetKV("ai_api_key", "sk-test-mock")
	_ = repo.KV.SetKV("ai_model", "gpt-test")

	autofillRes, svcerr := svc.AutofillFriendLink(userCtx(alice), &dto.FriendAutofillReq{
		URL: "https://creative.example.com",
	})
	if svcerr != nil {
		t.Fatalf("autofill creative site: %v", svcerr)
	}
	if autofillRes.RSSURL != "https://creative.example.com/dianbo-xml" || autofillRes.BacklinkURL != "https://creative.example.com/chuanmen" {
		t.Fatalf("expected AI-assisted autofill to discover verified rss & backlink, got %+v", autofillRes)
	}

	link3, svcerr := svc.AdminCreateLink(userCtx(admin), &dto.AdminUpsertFriendLinkReq{
		GroupID:  groupID,
		Name:     "Creative",
		URL:      "https://creative.example.com",
		Avatar:   "https://creative.example.com/favicon.ico",
		ColorKey: "violet",
		Status:   model.FriendStatusApproved,
	})
	if svcerr != nil {
		t.Fatalf("create link3: %v", svcerr)
	}
	WaitForFriendBackgroundTasks()
	probed3, svcerr := svc.AdminProbeLink(userCtx(admin), link3.ID)
	if svcerr != nil {
		t.Fatalf("probe link3: %v", svcerr)
	}
	if probed3.RSSURL != "https://creative.example.com/dianbo-xml" {
		t.Fatalf("expected AI fallback verified JSON feed https://creative.example.com/dianbo-xml, got %q", probed3.RSSURL)
	}
	if probed3.BacklinkStatus != model.FriendBacklinkVerified || probed3.BacklinkURL != "https://creative.example.com/chuanmen" {
		t.Fatalf("expected AI fallback verified backlink https://creative.example.com/chuanmen (rejecting evil.other.com), got status=%q url=%q", probed3.BacklinkStatus, probed3.BacklinkURL)
	}
}

func TestFriendDiscoverySecurityAndAdversarialCases(t *testing.T) {
	alice, _, _, admin := setupFriendTest(t)
	svc := NewFriendService()

	if err := repo.KV.SetKV("base_url", "https://myblog.example.org"); err != nil {
		t.Fatalf("set base_url: %v", err)
	}

	// 1. 验证多级中文 IDN 公共后缀隔离与 Punycode 同源一致性
	if sameFriendSiteFamily("alice.公司.香港", "bob.公司.香港") {
		t.Fatalf("expected multi-level IDN public suffix alice.公司.香港 vs bob.公司.香港 to be isolated")
	}
	if !sameFriendSiteFamily("blog.例子.中国", "api.例子.中国") {
		t.Fatalf("expected subdomains under 例子.中国 to share site family")
	}

	// 2. 验证 >64 KiB 被截断的合法 JSON Feed 仍可通过流式头部识别
	largeJSONFeed := `{"version":"https://jsonfeed.org/version/1.1","title":"Big Feed","items":[{"id":"1","content_html":"` + strings.Repeat("x", 90<<10) + `"}]}`
	truncatedHead := []byte(largeJSONFeed)[:friendFeedMaxBytes]
	if !isValidFeedDocument(truncatedHead) {
		t.Fatalf("expected >64 KiB JSON feed truncated at friendFeedMaxBytes to remain valid")
	}

	// 3. 验证 Sitemap <image:loc> / <video:loc> 不会被误当作独立页面提取
	rawSitemap := `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://blog.example.com/friends</loc>
    <image:image><image:loc>https://blog.example.com/uploads/cover.png</image:loc></image:image>
    <video:video><video:loc>https://blog.example.com/uploads/demo.mp4</video:loc></video:video>
  </url>
</urlset>`
	children, locs := parseSitemapXMLBytes([]byte(rawSitemap))
	if len(children) != 0 || len(locs) != 1 || locs[0] != "https://blog.example.com/friends" {
		t.Fatalf("expected only <url><loc> extracted, got children=%v locs=%v", children, locs)
	}

	pub, svcerr := svc.ListPublicFriends(context.Background(), "")
	if svcerr != nil || len(pub.Groups) == 0 {
		t.Fatalf("list groups: %v", svcerr)
	}
	groupID := pub.Groups[0].ID

	// 4. 直接提交跨站 BacklinkURL（企图借本站或第三方页面骗过反链校验）必须在参数校验阶段拦截
	if _, svcerr := svc.CreateMyFriendLink(userCtx(alice), &dto.UpsertMyFriendLinkReq{
		GroupID:     groupID,
		Name:        "Freeloader",
		URL:         "https://freeloader.example.com",
		Avatar:      "https://freeloader.example.com/a.png",
		BacklinkURL: "https://myblog.example.org/",
		ColorKey:    "sky",
	}); svcerr == nil || svcerr.Code != http.StatusBadRequest || !strings.Contains(svcerr.Error(), "invalid_friend_backlink") {
		t.Fatalf("expected cross-site backlink_url rejected with invalid_friend_backlink, got %+v", svcerr)
	}

	llmCalls := 0
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		llmCalls++
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"content": `{"rss_candidates":[],"backlink_candidates":[]}`}},
			},
		})
	}))
	t.Cleanup(aiServer.Close)
	_ = repo.KV.SetKV("ai_api_base_url", aiServer.URL)
	_ = repo.KV.SetKV("ai_api_key", "sk-test")
	_ = repo.KV.SetKV("ai_model", "gpt-test")

	flakyOnline := true
	origRT := friendOutboundRoundTripper
	friendOutboundRoundTripper = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Hostname() {
		case "myblog.example.org":
			return htmlResp(200, "text/html", `<html><body><a href="https://myblog.example.org">Self Nav</a></body></html>`, req), nil
		case "sneaky.example.com":
			if req.URL.Path == "/links" {
				// 恶意 302 重定向到本站，企图利用本站自身导航链接骗取 verified
				return &http.Response{
					StatusCode: http.StatusFound,
					Header:     http.Header{"Location": []string{"https://myblog.example.org/"}},
					Body:       io.NopCloser(strings.NewReader("")),
					Request:    req,
				}, nil
			}
			if req.URL.Path == "/" || req.URL.Path == "" {
				return htmlResp(200, "text/html", `<html><body><nav><a href="/notes">笔记</a></nav></body></html>`, req), nil
			}
			return htmlResp(404, "text/plain", "404", req), nil
		case "flaky.example.com":
			if !flakyOnline {
				return htmlResp(502, "text/plain", "bad gateway", req), nil
			}
			switch req.URL.Path {
			case "/", "":
				return htmlResp(200, "text/html", `<html><body>hello</body></html>`, req), nil
			case "/friends":
				return htmlResp(200, "text/html", `<html><body><a href="https://myblog.example.org">Friend</a></body></html>`, req), nil
			default:
				return htmlResp(404, "text/plain", "404", req), nil
			}
		}
		return htmlResp(404, "text/plain", "404", req), nil
	})
	t.Cleanup(func() {
		friendOutboundRoundTripper = origRT
	})

	// 5. 留空 BacklinkURL 但对方 /links 302 跳转到本站：绝不能被判为 verified，更不能回填
	sneakyLink, svcerr := svc.AdminCreateLink(userCtx(admin), &dto.AdminUpsertFriendLinkReq{
		GroupID:  groupID,
		Name:     "Sneaky Redirect",
		URL:      "https://sneaky.example.com",
		Avatar:   "https://sneaky.example.com/a.png",
		ColorKey: "crimson",
		Status:   model.FriendStatusApproved,
	})
	if svcerr != nil {
		t.Fatalf("create sneakyLink: %v", svcerr)
	}
	WaitForFriendBackgroundTasks()
	sneakyProbed, svcerr := svc.AdminProbeLink(userCtx(admin), sneakyLink.ID)
	if svcerr != nil {
		t.Fatalf("probe sneakyLink: %v", svcerr)
	}
	if sneakyProbed.BacklinkStatus == model.FriendBacklinkVerified || sneakyProbed.BacklinkURL != "" {
		t.Fatalf("302 redirect to selfHost bypassed backlink check: status=%q url=%q", sneakyProbed.BacklinkStatus, sneakyProbed.BacklinkURL)
	}

	// 6. 批量全量拨测 RunFriendLinksProbeRound(true) 绝不触发 LLM 兜底风暴
	callsBeforeBatch := llmCalls
	RunFriendLinksProbeRound(true)
	if llmCalls != callsBeforeBatch {
		t.Fatalf("expected batch probe round to trigger 0 LLM calls, got %d -> %d", callsBeforeBatch, llmCalls)
	}

	// 7. 瞬时故障（!Reachable）不得将已 verified 的反链覆盖为 missing；且 AdminReviewLink 不会覆盖已回填的字段
	flakyLink, svcerr := svc.AdminCreateLink(userCtx(admin), &dto.AdminUpsertFriendLinkReq{
		GroupID:  groupID,
		Name:     "Flaky Blog",
		URL:      "https://flaky.example.com",
		Avatar:   "https://flaky.example.com/a.png",
		ColorKey: "jade",
		Status:   model.FriendStatusPreApproved,
	})
	if svcerr != nil {
		t.Fatalf("create flakyLink: %v", svcerr)
	}
	WaitForFriendBackgroundTasks()

	reviewedFlaky, svcerr := svc.AdminReviewLink(userCtx(admin), flakyLink.ID, &dto.AdminReviewFriendLinkReq{
		Status:     model.FriendStatusApproved,
		ReviewNote: "人工复核通过",
	})
	if svcerr != nil {
		t.Fatalf("review flakyLink: %v", svcerr)
	}
	if reviewedFlaky.BacklinkStatus != model.FriendBacklinkVerified || reviewedFlaky.BacklinkURL != "https://flaky.example.com/friends" {
		t.Fatalf("expected AdminReviewLink to preserve backfilled backlink, got status=%q url=%q", reviewedFlaky.BacklinkStatus, reviewedFlaky.BacklinkURL)
	}

	flakyOnline = false
	afterOutage, svcerr := svc.AdminProbeLink(userCtx(admin), flakyLink.ID)
	if svcerr != nil {
		t.Fatalf("probe flakyLink during outage: %v", svcerr)
	}
	if afterOutage.BacklinkStatus != model.FriendBacklinkVerified {
		t.Fatalf("expected transient outage to preserve verified backlink_status, got %q", afterOutage.BacklinkStatus)
	}
}
