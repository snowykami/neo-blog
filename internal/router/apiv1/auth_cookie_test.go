package apiv1

import (
	"bytes"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 登录与静默续期写入的 Cookie 有效期跟随后台配置，「记住我」在续期后仍然保留
func TestAuthCookieMaxAge(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	utils.Jwt.Durations = tools.GetAuthDurations
	t.Cleanup(func() { utils.Jwt.Durations = nil })
	hashed, _ := utils.Password.HashPassword("secret")
	repo.GetDB().Create(&model.User{Username: "alice", Email: "alice@test.local", Password: hashed, Role: constant.RoleUser})
	base := startRoutes(t, registerUserRoutes)

	login := func(remember bool) map[string]*http.Cookie {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"username": "alice", "password": "secret", "remember_me": remember})
		resp, err := http.Post(base+"/user/login", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("login status = %d", resp.StatusCode)
		}
		return cookiesByName(resp)
	}
	// Max-Age 为令牌剩余秒数，允许请求耗时带来的几秒误差
	expectMaxAge := func(c *http.Cookie, want time.Duration) {
		t.Helper()
		if c == nil {
			t.Fatal("cookie missing")
		}
		if got := time.Duration(c.MaxAge) * time.Second; got > want || got < want-5*time.Second {
			t.Fatalf("%s Max-Age = %v, want %v", c.Name, got, want)
		}
	}

	day := 24 * time.Hour
	plain := login(false)
	expectMaxAge(plain["token"], 300*time.Second)
	expectMaxAge(plain["refresh_token"], 7*day)
	remembered := login(true)
	expectMaxAge(remembered["refresh_token"], 30*day)

	// 访问令牌过期后只带刷新令牌访问：续期写回的刷新令牌 Cookie 仍是 30 天，而不是回落到不记住时的时长
	req, _ := http.NewRequest(http.MethodGet, base+"/user/me", nil)
	req.AddCookie(remembered["refresh_token"])
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("renew status = %d", resp.StatusCode)
	}
	renewed := cookiesByName(resp)
	expectMaxAge(renewed["token"], 300*time.Second)
	expectMaxAge(renewed["refresh_token"], 30*day)

	// 后台修改后对新登录生效
	_ = repo.KV.SetKV("token_duration", 120)
	_ = repo.KV.SetKV("refresh_token_days", 10)
	configured := login(false)
	expectMaxAge(configured["token"], 120*time.Second)
	expectMaxAge(configured["refresh_token"], 10*day)
}

func cookiesByName(resp *http.Response) map[string]*http.Cookie {
	cookies := map[string]*http.Cookie{}
	for _, c := range resp.Cookies() {
		cookies[c.Name] = c
	}
	return cookies
}
