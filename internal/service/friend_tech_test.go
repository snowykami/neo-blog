package service

import (
	"context"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
)

func techIDs(items []model.FriendTechItem) []string {
	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	return ids
}

func TestDetectFriendTechStackCategoriesAndImplication(t *testing.T) {
	t.Run("Next.js implies React and orders cdn -> server -> cms -> framework", func(t *testing.T) {
		h := http.Header{}
		h.Set("CF-Ray", "8ef123456789-HKG")
		h.Set("Server", "Caddy")
		htmlDoc := `<!DOCTYPE html><html><head>
			<meta name="generator" content="neo-blog" />
			<script src="/_next/static/chunks/main-app.js" defer></script>
		</head><body><h1>Hello</h1></body></html>`

		got := DetectFriendTechStack(h, htmlDoc, false)
		want := []string{"cloudflare", "caddy", "neo-blog", "nextjs", "react"}
		if !slices.Equal(techIDs(got), want) {
			t.Fatalf("got %v, want %v (full=%+v)", techIDs(got), want, got)
		}
		if got[0].Category != model.FriendTechCategoryCDN ||
			got[1].Category != model.FriendTechCategoryServer ||
			got[2].Category != model.FriendTechCategoryCMS ||
			got[3].Category != model.FriendTechCategoryFramework ||
			got[4].Category != model.FriendTechCategoryFramework {
			t.Fatalf("unexpected category order: %+v", got)
		}
	})

	t.Run("Nuxt implies Vue and EdgeOne + OpenResty detected", func(t *testing.T) {
		h := http.Header{}
		h.Set("EO-Log-UUID", "12345-67890")
		h.Set("Server", "openresty/1.25.3.1")
		htmlDoc := `<html><body><div id="__nuxt"></div><script src="/_nuxt/entry.abc.js"></script></body></html>`

		got := DetectFriendTechStack(h, htmlDoc, false)
		want := []string{"edgeone", "openresty", "nuxt", "vue"}
		if !slices.Equal(techIDs(got), want) {
			t.Fatalf("got %v, want %v", techIDs(got), want)
		}
	})

	t.Run("WordPress, Halo, Typecho, Astro, Hugo, Hexo, SvelteKit, jQuery", func(t *testing.T) {
		wpHeader := http.Header{}
		wpHeader.Set("Server", "nginx/1.26.0")
		wpHeader.Add("Set-Cookie", "wordpress_test_cookie=WP+Cookie+check; path=/")
		wpHTML := `<html><head><link rel="stylesheet" href="/wp-content/themes/twentytwentyfour/style.css" /><script src="/wp-includes/js/jquery/jquery-3.7.1.min.js"></script></head></html>`
		if got := techIDs(DetectFriendTechStack(wpHeader, wpHTML, false)); !slices.Equal(got, []string{"nginx", "wordpress", "jquery"}) {
			t.Fatalf("wordpress got %v", got)
		}

		haloHeader := http.Header{}
		haloHeader.Set("Server", "Traefik")
		haloHeader.Add("Set-Cookie", "HALO_SESSION=secret-session-token-must-not-leak; Path=/; HttpOnly")
		sanitized := cloneFriendTechHeaders(haloHeader)
		if strings.Contains(strings.Join(sanitized.Values("Set-Cookie"), ";"), "secret-session-token") {
			t.Fatalf("expected Set-Cookie secret value to be stripped, got %v", sanitized.Values("Set-Cookie"))
		}
		if got := techIDs(DetectFriendTechStack(sanitized, `<html></html>`, false)); !slices.Equal(got, []string{"traefik", "halo"}) {
			t.Fatalf("halo got %v", got)
		}

		astroHeader := http.Header{}
		astroHeader.Set("X-Vercel-Id", "hkg1::abc")
		astroHTML := `<html><head><meta name="generator" content="Astro v4.16.0"><link rel="stylesheet" href="/_astro/index.css"></head><body><div data-v-7ba5bd90></div></body></html>`
		if got := techIDs(DetectFriendTechStack(astroHeader, astroHTML, false)); !slices.Equal(got, []string{"vercel", "astro", "vue"}) {
			t.Fatalf("astro+vue got %v", got)
		}

		typechoHTML := `<html><head><meta name="generator" content="Typecho 1.2.1" /><link rel="stylesheet" href="/usr/themes/default/style.css" /></head></html>`
		if got := techIDs(DetectFriendTechStack(nil, typechoHTML, false)); !slices.Equal(got, []string{"typecho"}) {
			t.Fatalf("typecho got %v", got)
		}

		svelteHeader := http.Header{"X-NF-Request-ID": []string{"nf-123"}, "Server": []string{"Netlify"}}
		svelteHTML := `<html><body data-sveltekit-preload-data="hover"><script>__sveltekit_1abc = {};</script></body></html>`
		if got := techIDs(DetectFriendTechStack(svelteHeader, svelteHTML, false)); !slices.Equal(got, []string{"netlify", "sveltekit"}) {
			t.Fatalf("sveltekit got %v", got)
		}
	})

	t.Run("Prose text, JSON-LD, cross-origin avatars and third-party widgets never trigger false positives", func(t *testing.T) {
		h := http.Header{}
		// 超长 Link 预加载头后紧跟 WordPress API 标识，验证 1024 字节截断上限不会丢信号
		longPreload := "<" + strings.Repeat("https://hugo-blog.example.com/assets/font-preload-", 6) + "a.woff2>; rel=preload; as=font"
		wpLinkHeader := http.Header{"Link": []string{longPreload + `, <https://wp.example.com/wp-json/>; rel="https://api.w.org/"`}}
		if gotWP := techIDs(DetectFriendTechStackWithHost("wp.example.com", wpLinkHeader, "<html></html>", false)); !slices.Equal(gotWP, []string{"wordpress"}) {
			t.Fatalf("expected wordpress from long Link header, got %v", gotWP)
		}

		// 畸形无值 Cookie 后带分号属性，验证分号先于等号截断
		weirdCookie := cloneFriendTechHeaders(http.Header{"Set-Cookie": []string{"HttpOnly; Domain=wordpress_fake"}})
		if len(weirdCookie.Values("Set-Cookie")) != 0 {
			t.Fatalf("expected malformed flag-only Set-Cookie to be ignored, got %v", weirdCookie)
		}

		htmlDoc := `<!DOCTYPE html><html><head>
			<title>从 WordPress 与 Hexo 迁移到 Hugo 的踩坑记录</title>
			<script type="application/ld+json">
				{"@context":"https://schema.org","headline":"深入解析 __NEXT_DATA__、self.__next_f、window.__NUXT__ 与 __sveltekit_ 原理"}
			</script>
			<link rel="stylesheet" href="https://widget.example.net/_astro/embed.css" />
			<script src="//giscus.app/_next/static/chunks/widget.js"></script>
		</head>
		<body>
			<article>
				<p>本文对比了 Cloudflare、Vercel、Nginx、Caddy、Next.js、Nuxt、React、Vue 与 jQuery。</p>
				<a href="https://wordpress.org/wp-content/uploads/demo.png">External Link</a>
				<img src="https://our-neoblog.example.org/api/site-icon" alt="neo-blog friend" />
				<img src="https://our-neoblog.example.org/api/v1/file/f/42/avatar.webp" alt="neo-blog file" />
				<img src="https://s0.wp.com/wp-content/uploads/avatar.jpg" alt="wp friend" />
				<img src="https://friend.typecho.example/usr/themes/handsome/avatar.png" alt="typecho friend" />
				<div data-v-nothexhash="1">Custom attr</div>
			</article>
		</body></html>`
		got := DetectFriendTechStackWithHost("hugo-blog.example.com", h, htmlDoc, false)
		if len(got) != 0 {
			t.Fatalf("expected 0 false positives from cross-origin assets & JSON-LD, got %+v", got)
		}

		// 相对路径（不带前导斜杠或带 ./）与公共 CDN 上的 jQuery 应正常识别
		relHTML := `<html><head><link rel="stylesheet" href="_astro/index.css"><script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script></head></html>`
		if gotRel := techIDs(DetectFriendTechStackWithHost("astro-blog.example.com", nil, relHTML, false)); !slices.Equal(gotRel, []string{"astro", "jquery"}) {
			t.Fatalf("relative _astro + cdn jquery got %v", gotRel)
		}

		// 博文正文讨论雷池 /_safeline/、Anubis /.within.website/x/cmd/anubis/、EdgeOne eo_bot_verify 时不应被误判为 WAF 盾页
		wafProseHTML := `<!DOCTYPE html><html><head><meta name="generator" content="Hugo 0.139.0" /></head>
		<body><article><p>记一次部署 SafeLineChallenge /_safeline/、sl-challenge、eo_bot_verify 与 /.within.website/x/cmd/anubis/ 的踩坑过程。</p></article></body></html>`
		if isLikelyWAFInterstitial(http.StatusOK, nil, wafProseHTML) {
			t.Fatalf("blog post prose mentioning WAF keywords should NOT be marked as WAF interstitial")
		}
		if gotHugo := techIDs(DetectFriendTechStackWithHost("selfhost.example.com", nil, wafProseHTML, false)); !slices.Equal(gotHugo, []string{"hugo"}) {
			t.Fatalf("expected hugo on WAF-prose blog post, got %v", gotHugo)
		}
	})
}

func TestFriendTechStackWAFProtectionAndProbePersistence(t *testing.T) {
	_, _, _, admin := setupFriendTest(t)
	svc := NewFriendService()
	adminCtx := userCtx(admin)

	pubInitial, svcerr := svc.ListPublicFriends(context.Background(), "")
	if svcerr != nil || len(pubInitial.Groups) == 0 {
		t.Fatalf("ListPublicFriends: %v", svcerr)
	}
	groupID := pubInitial.Groups[0].ID

	var probePhase int // 0=正常访问, 1=Cloudflare 403 盾页, 2=雷池 SafeLine HTTP 200 Vue 盾页, 3=跨域重定向外部登录页
	origRT := friendOutboundRoundTripper
	friendOutboundRoundTripper = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Hostname() == "access-login.external-auth.example" {
			h := http.Header{
				"Content-Type": []string{"text/html; charset=utf-8"},
				"Server":       []string{"nginx"},
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     h,
				Body:       io.NopCloser(strings.NewReader(`<html><head><meta name="generator" content="WordPress 6.7" /></head></html>`)),
				Request:    req,
			}, nil
		}
		if req.URL.Hostname() != "shielded-blog.example.com" {
			return htmlResp(404, "text/plain", "not found", req), nil
		}
		if req.URL.Path != "/" && req.URL.Path != "" {
			return htmlResp(404, "text/plain", "not found", req), nil
		}
		switch probePhase {
		case 0:
			h := http.Header{
				"Content-Type": []string{"text/html; charset=utf-8"},
				"EO-Log-UUID":  []string{"eo-uuid-1"},
				"Server":       []string{"Caddy"},
			}
			body := `<!DOCTYPE html><html><head><meta name="generator" content="Hexo 7.3.0" /></head><body><p>Indie Blog</p></body></html>`
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     h,
				Body:       io.NopCloser(strings.NewReader(body)),
				Request:    req,
			}, nil
		case 1:
			// 开启 Cloudflare WAF 403 中文挑战页：即使盾页内含有干扰脚本特征，也不得覆盖站点已有的 Caddy / Hexo 标签
			h := http.Header{
				"Content-Type": []string{"text/html; charset=utf-8"},
				"Server":       []string{"cloudflare"},
				"CF-Ray":       []string{"8ef999-LAX"},
				"Cf-Mitigated": []string{"challenge"},
			}
			challengeBody := `<!DOCTYPE html><html><head><title>请稍候…</title></head><body><div id="challenge-error-text"></div><script id="__NEXT_DATA__" type="application/json">{}</script></body></html>`
			return &http.Response{
				StatusCode: http.StatusForbidden,
				Header:     h,
				Body:       io.NopCloser(strings.NewReader(challengeBody)),
				Request:    req,
			}, nil
		case 2:
			// 开启雷池 SafeLine HTTP 200 挑战页（内部含 Vue data-v-* 属性）：不得把 Hexo 覆盖为 Vue
			h := http.Header{
				"Content-Type": []string{"text/html; charset=utf-8"},
				"Server":       []string{"cloudflare"},
				"CF-Ray":       []string{"8ef999-HKG"},
			}
			safelineBody := `<!DOCTYPE html><html><body><div data-v-1234abcd class="sl-challenge"><script src="/_safeline/static/challenge.js"></script></div></body></html>`
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     h,
				Body:       io.NopCloser(strings.NewReader(safelineBody)),
				Request:    req,
			}, nil
		default:
			// 临时 302 跳转到跨域外部认证页：不得用外部域名的 WordPress/Nginx 覆盖原博客技术栈
			h := http.Header{
				"Location": []string{"https://access-login.external-auth.example/login"},
			}
			return &http.Response{
				StatusCode: http.StatusFound,
				Header:     h,
				Body:       io.NopCloser(strings.NewReader("")),
				Request:    req,
			}, nil
		}
	})
	t.Cleanup(func() {
		friendOutboundRoundTripper = origRT
	})

	created, svcerr := svc.AdminCreateLink(adminCtx, &dto.AdminUpsertFriendLinkReq{
		GroupID:     groupID,
		Name:        "Shielded Indie",
		URL:         "https://shielded-blog.example.com",
		Avatar:      "https://shielded-blog.example.com/avatar.png",
		Description: "Hexo blog",
		ColorKey:    "sky",
		Status:      model.FriendStatusApproved,
	})
	if svcerr != nil {
		t.Fatalf("AdminCreateLink: %v", svcerr)
	}
	WaitForFriendBackgroundTasks()

	link, err := repo.Friend.GetLink(created.ID)
	if err != nil {
		t.Fatalf("GetLink: %v", err)
	}
	firstIDs := techIDs(model.ParseFriendTechStack(link.TechStack))
	wantFirst := []string{"edgeone", "caddy", "hexo"}
	if !slices.Equal(firstIDs, wantFirst) {
		t.Fatalf("first probe tech_stack = %v, want %v", firstIDs, wantFirst)
	}

	// 预置已验证反链状态，确认后续命中 WAF 盾页时不会把 verified 反链误改为 missing
	if err := repo.Friend.UpdateLinkProbeColumns(link.ID, link.URL, link.BacklinkURL, link.GroupID, map[string]any{
		"backlink_status": model.FriendBacklinkVerified,
	}); err != nil {
		t.Fatalf("seed verified backlink: %v", err)
	}
	link.BacklinkStatus = model.FriendBacklinkVerified

	// 阶段 1：切换至 Cloudflare WAF 403 挑战页后再次拨测：CDN 更新为 cloudflare，保留原有的 caddy + hexo 与 verified 反链状态
	probePhase = 1
	probeAndPersistSingleLink(context.Background(), link, true, false)

	reloaded, err := repo.Friend.GetLink(created.ID)
	if err != nil {
		t.Fatalf("GetLink after WAF probe: %v", err)
	}
	if reloaded.BacklinkStatus != model.FriendBacklinkVerified {
		t.Fatalf("expected verified backlink to survive WAF challenge, got %q", reloaded.BacklinkStatus)
	}
	afterWAFIDs := techIDs(model.ParseFriendTechStack(reloaded.TechStack))
	wantAfterWAF := []string{"cloudflare", "caddy", "hexo"}
	if !slices.Equal(afterWAFIDs, wantAfterWAF) {
		t.Fatalf("after WAF probe tech_stack = %v, want %v", afterWAFIDs, wantAfterWAF)
	}

	// 阶段 2：切换至雷池 SafeLine HTTP 200 挑战页（含 Vue data-v-*）：仍保留 caddy + hexo，不误染 vue
	probePhase = 2
	probeAndPersistSingleLink(context.Background(), reloaded, false, false)
	afterSafeline, err := repo.Friend.GetLink(created.ID)
	if err != nil {
		t.Fatalf("GetLink after SafeLine probe: %v", err)
	}
	if got := techIDs(model.ParseFriendTechStack(afterSafeline.TechStack)); !slices.Equal(got, wantAfterWAF) {
		t.Fatalf("after SafeLine 200 WAF probe tech_stack = %v, want %v", got, wantAfterWAF)
	}

	// 阶段 3：302 跨域跳转到外部登录域名：不覆盖原博客已持久化的技术栈
	probePhase = 3
	probeAndPersistSingleLink(context.Background(), afterSafeline, false, false)
	afterRedirect, err := repo.Friend.GetLink(created.ID)
	if err != nil {
		t.Fatalf("GetLink after cross-domain redirect: %v", err)
	}
	if got := techIDs(model.ParseFriendTechStack(afterRedirect.TechStack)); !slices.Equal(got, wantAfterWAF) {
		t.Fatalf("after cross-domain redirect tech_stack = %v, want %v", got, wantAfterWAF)
	}

	pubResp, svcerr := svc.ListPublicFriends(context.Background(), "")
	if svcerr != nil {
		t.Fatalf("ListPublicFriends: %v", svcerr)
	}
	var foundPub *dto.FriendLinkPublicDto
	for gi := range pubResp.Groups {
		for li := range pubResp.Groups[gi].Links {
			if pubResp.Groups[gi].Links[li].ID == created.ID {
				foundPub = &pubResp.Groups[gi].Links[li]
				break
			}
		}
	}
	if foundPub == nil || !slices.Equal(techIDs(foundPub.TechStack), wantAfterWAF) {
		t.Fatalf("public DTO tech_stack = %+v, want %v", foundPub, wantAfterWAF)
	}
}
