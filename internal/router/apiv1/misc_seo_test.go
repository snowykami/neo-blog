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

// 站点地图列出公开的独立页面（私密页面与链接页面不列）；站点信息带上站点语言，前端据此决定没有语言偏好的访客看到的界面语言
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

	var info struct {
		Data struct {
			DefaultLanguage string `json:"default_language"`
		} `json:"data"`
	}
	getJSON(t, base+"/misc/site-info", &info)
	if info.Data.DefaultLanguage != "zh-cn" {
		t.Fatalf("site-info default_language = %q, want zh-cn", info.Data.DefaultLanguage)
	}
	// 已保存过整体站点信息时同样带上（站点语言是独立配置项，不在 site_info 里）
	if err := repo.KV.SetKV("site_info", map[string]any{"metadata": map[string]any{"name": "Kami"}}); err != nil {
		t.Fatalf("save site_info: %v", err)
	}
	if err := repo.KV.SetKV("default_language", "ja-jp"); err != nil {
		t.Fatalf("save default_language: %v", err)
	}
	getJSON(t, base+"/misc/site-info", &info)
	if info.Data.DefaultLanguage != "ja-jp" {
		t.Fatalf("site-info default_language = %q, want ja-jp", info.Data.DefaultLanguage)
	}
}
