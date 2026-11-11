package apiv1

import (
	"encoding/json"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 邮件头 List-Unsubscribe 的一键退订：邮箱客户端带着查询参数里的凭据 POST，关掉全部通知邮件；
// 没有凭据或凭据无效时拒绝，也不认登录 Cookie
func TestNotificationOneClickUnsubscribe(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	user := &model.User{Username: "reader", Email: "reader@test.local", Role: constant.RoleUser}
	if err := repo.GetDB().Create(user).Error; err != nil {
		t.Fatal(err)
	}
	base := startRoutes(t, registerNotificationRoutes)

	post := func(query, cookie string) int {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, base+"/notifications/one-click-unsubscribe"+query, strings.NewReader("List-Unsubscribe=One-Click"))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := post("", loginCookie(t, user)); code != http.StatusUnauthorized {
		t.Fatalf("without token = %d, want 401 (login cookie is not accepted here)", code)
	}
	if code := post("?token=garbage", ""); code != http.StatusUnauthorized {
		t.Fatalf("invalid token = %d, want 401", code)
	}
	token := service.SignNotificationPrefsToken(user.ID, time.Now())
	if code := post("?token="+url.QueryEscape(token), ""); code != http.StatusOK {
		t.Fatalf("one-click unsubscribe = %d, want 200", code)
	}

	req, _ := http.NewRequest(http.MethodGet, base+"/notifications/preferences", nil)
	req.Header.Set(middleware.NotifyPrefsTokenHeader, token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var envelope struct {
		Data struct {
			Email []string `json:"email"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Data.Email) != 0 {
		t.Fatalf("email types after unsubscribe = %v, want none", envelope.Data.Email)
	}
}
