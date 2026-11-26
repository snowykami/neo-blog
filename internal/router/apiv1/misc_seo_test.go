package apiv1

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func getJSON(t *testing.T, url string, out any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status %d", url, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		t.Fatalf("decode %s: %v", url, err)
	}
}

// 站点地图列出公开的独立页面（私密页面与链接页面不列）；站点语言写进 RSS 订阅源，前台站点信息不带它
func TestSitemapPagesAndSiteLanguage(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	for _, page := range []model.Page{
		{PageBase: model.PageBase{Title: "about", Slug: "about-blog", Kind: model.PageKindContent}},
		{PageBase: model.PageBase{Title: "demo", Slug: "html-demo", Kind: model.PageKindHTML}},
		{PageBase: model.PageBase{Title: "secret", Slug: "secret", Kind: model.PageKindContent, IsPrivate: true}},
		{PageBase: model.PageBase{Title: "music", Slug: "music-link", Kind: model.PageKindLink, LinkURL: "/music"}},
	} {
		if err := repo.GetDB().Create(&page).Error; err != nil {
			t.Fatalf("create page: %v", err)
		}
	}
	base := startRoutes(t, registerMiscRoutes)

	var sitemap struct {
		Data struct {
			Pages []struct {
				Slug string `json:"slug"`
			} `json:"pages"`
		} `json:"data"`
	}
	getJSON(t, base+"/misc/sitemap-data", &sitemap)
	slugs := map[string]bool{}
	for _, p := range sitemap.Data.Pages {
		slugs[p.Slug] = true
	}
	if len(slugs) != 2 || !slugs["about-blog"] || !slugs["html-demo"] {
		t.Fatalf("sitemap pages = %v, want only public content and HTML pages", slugs)
	}

	// 站点语言只用于 RSS 订阅源的 <language> 与验证码邮件，不再放进前台站点信息
	var rss struct {
		Data struct {
			Language string `json:"language"`
		} `json:"data"`
	}
	getJSON(t, base+"/misc/rss-data", &rss)
	if rss.Data.Language != "zh-cn" {
		t.Fatalf("rss-data language = %q, want zh-cn", rss.Data.Language)
	}
	if err := repo.KV.SetKV("default_language", "ja-jp"); err != nil {
		t.Fatalf("save default_language: %v", err)
	}
	getJSON(t, base+"/misc/rss-data", &rss)
	if rss.Data.Language != "ja-jp" {
		t.Fatalf("rss-data language = %q, want ja-jp", rss.Data.Language)
	}
	var info struct {
		Data map[string]any `json:"data"`
	}
	getJSON(t, base+"/misc/site-info", &info)
	if _, ok := info.Data["default_language"]; ok {
		t.Fatalf("site-info should not carry default_language")
	}
	seoMap, ok := info.Data["seo"].(map[string]any)
	if !ok {
		t.Fatalf("site-info should carry default seo config map, got %T", info.Data["seo"])
	}
	if seoMap["allow_indexing"] != true ||
		seoMap["sitemap_enabled"] != true ||
		seoMap["sitemap_locale_mode"] != "default_only" ||
		seoMap["locale_index_mode"] != "canonical_default" ||
		seoMap["rss_enabled"] != true ||
		seoMap["twitter_card"] != "summary_large_image" {
		t.Fatalf("unexpected default seo settings: %#v", seoMap)
	}
}

func TestSeoConfigRssAndSitemapFriends(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}

	user := model.User{Username: "author1", Role: constant.RoleAdmin}
	if err := repo.GetDB().Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	post := model.Post{
		UserID: user.ID,
		PostBase: model.PostBase{
			Title:       "SEO 实战",
			Description: "手写摘要",
			Content:     "<p>这是一段完整的文章正文内容。</p>",
		},
		Excerpt: "这是一段完整的文章正文内容。",
	}
	if err := repo.GetDB().Create(&post).Error; err != nil {
		t.Fatalf("create post: %v", err)
	}
	groups, err := repo.Friend.ListGroups(true, "")
	if err != nil || len(groups) == 0 {
		t.Fatalf("list friend groups: %v", err)
	}
	link := model.FriendLink{
		GroupID:        groups[0].ID,
		Name:           "Friend Blog",
		URL:            "https://friend.example.com",
		NormalizedHost: "friend.example.com",
		Status:         model.FriendStatusApproved,
		ColorKey:       "sky",
	}
	if err := repo.Friend.CreateLink(&link); err != nil {
		t.Fatalf("create friend link: %v", err)
	}

	base := startRoutes(t, registerMiscRoutes)

	var sm struct {
		Data struct {
			SitemapEnabled    bool   `json:"sitemap_enabled"`
			SitemapLocaleMode string `json:"sitemap_locale_mode"`
			FriendsEnabled    bool   `json:"friends_enabled"`
			FriendsUpdatedAt  string `json:"friends_updated_at"`
		} `json:"data"`
	}
	getJSON(t, base+"/misc/sitemap-data", &sm)
	if !sm.Data.SitemapEnabled || sm.Data.SitemapLocaleMode != "default_only" || !sm.Data.FriendsEnabled || sm.Data.FriendsUpdatedAt == "" {
		t.Fatalf("unexpected sitemap seo fields: %+v", sm.Data)
	}

	// 切换为仅摘要输出 + 自定义 RSS 描述
	if err := repo.KV.SetKV("rss_full_content", false); err != nil {
		t.Fatal(err)
	}
	if err := repo.KV.SetKV("rss_description", "自定义订阅简介"); err != nil {
		t.Fatal(err)
	}
	var rssSummary struct {
		Data struct {
			Enabled          bool   `json:"enabled"`
			FullContent      bool   `json:"full_content"`
			Description      string `json:"description"`
			PostDefaultCover string `json:"post_default_cover"`
			Posts            []struct {
				Description string `json:"description"`
				Excerpt     string `json:"excerpt"`
				Content     string `json:"content"`
			} `json:"posts"`
		} `json:"data"`
	}
	getJSON(t, base+"/misc/rss-data", &rssSummary)
	if !rssSummary.Data.Enabled || rssSummary.Data.FullContent || rssSummary.Data.Description != "自定义订阅简介" || rssSummary.Data.PostDefaultCover != "" {
		t.Fatalf("unexpected rss summary metadata: %+v", rssSummary.Data)
	}
	if len(rssSummary.Data.Posts) != 1 || rssSummary.Data.Posts[0].Content != "" || rssSummary.Data.Posts[0].Description != "手写摘要" {
		t.Fatalf("expected summary-only rss item without full content, got %+v", rssSummary.Data.Posts)
	}

	// 关闭全站索引时，sitemap-data 立即短路为空列表且 site-info.seo.sitemap_enabled 同步为 false
	if err := repo.KV.SetKV("seo_allow_indexing", false); err != nil {
		t.Fatal(err)
	}
	var smDisabled struct {
		Data struct {
			SitemapEnabled bool  `json:"sitemap_enabled"`
			Posts          []any `json:"posts"`
		} `json:"data"`
	}
	getJSON(t, base+"/misc/sitemap-data", &smDisabled)
	if smDisabled.Data.SitemapEnabled || len(smDisabled.Data.Posts) != 0 {
		t.Fatalf("expected sitemap short-circuited when seo_allow_indexing=false, got %+v", smDisabled.Data)
	}

	// 关闭 RSS 后返回 enabled=false 且不查文章列表
	if err := repo.KV.SetKV("rss_enabled", false); err != nil {
		t.Fatal(err)
	}
	var rssDisabled struct {
		Data struct {
			Enabled bool  `json:"enabled"`
			Posts   []any `json:"posts"`
		} `json:"data"`
	}
	getJSON(t, base+"/misc/rss-data", &rssDisabled)
	if rssDisabled.Data.Enabled || len(rssDisabled.Data.Posts) != 0 {
		t.Fatalf("expected rss disabled response, got %+v", rssDisabled.Data)
	}
}
