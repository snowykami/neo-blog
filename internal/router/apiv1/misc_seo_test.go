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
}
