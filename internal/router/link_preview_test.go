package router

import (
	"net/http"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 外链预览路由：校验查询参数绑定、未登录访客白名单拦截与错误响应缓存头
func TestLinkPreviewRouteAccessControl(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}

	content := `<p><a href="https://wompa.land/articles/iterm-status-bar">iTerm2</a></p>`
	post := &model.Post{
		PostBase: model.PostBase{
			Title:     "测试文章",
			Content:   content,
			IsPrivate: false,
		},
	}
	if err := repo.GetDB().Create(post).Error; err != nil {
		t.Fatalf("create post: %v", err)
	}

	// 非法协议返回 400 且禁止缓存
	w := ut.PerformRequest(h.Engine, http.MethodGet, "/api/v1/misc/link-preview?url="+url.QueryEscape("javascript:alert(1)"), nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid url status = %d, want 400", w.Code)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("invalid url Cache-Control = %q, want no-store", got)
	}

	// 匿名访客不传 target_type / target_id 时拒绝代理抓取
	w = ut.PerformRequest(h.Engine, http.MethodGet, "/api/v1/misc/link-preview?url="+url.QueryEscape("https://wompa.land/articles/iterm-status-bar"), nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("missing target status = %d, want 403", w.Code)
	}

	// 匿名访客请求不在该文章内的任意外链时拒绝代理抓取
	q := url.Values{
		"url":         {"https://evil.example.org/ssrf"},
		"target_type": {"post"},
		"target_id":   {"1"},
	}
	w = ut.PerformRequest(h.Engine, http.MethodGet, "/api/v1/misc/link-preview?"+q.Encode(), nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("unlisted url status = %d, want 403", w.Code)
	}
}
