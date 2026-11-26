package apiv1

import (
	"bufio"
	"context"
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
	"github.com/snowykami/neo-blog/pkg/sharedstate"
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

// 模拟连续刷新页面 / 重跑 Lighthouse：客户端关闭 SSE 连接后服务端应立即感知断连并释放名额，
// 连续打开并关闭 2 倍于单用户上限（24 次）的流不应耗尽名额触发 429
func TestNotificationStreamRapidReconnectReleasesSlot(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	user := &model.User{Username: "streamer", Email: "streamer@test.local", Role: constant.RoleUser}
	if err := repo.GetDB().Create(user).Error; err != nil {
		t.Fatal(err)
	}
	base := startRoutes(t, registerNotificationRoutes)
	cookie := loginCookie(t, user)
	// 使用独立 Transport 确保每次请求关闭时真实断开 TCP 连接
	client := &http.Client{
		Transport: &http.Transport{DisableKeepAlives: true},
		Timeout:   3 * time.Second,
	}

	totalRuns := service.NotificationStreamMaxPerUser * 2
	for i := 0; i < totalRuns; i++ {
		reqCtx, cancel := context.WithCancel(context.Background())
		req, _ := http.NewRequestWithContext(reqCtx, http.MethodGet, base+"/notifications/stream", nil)
		req.Header.Set("Cookie", cookie)
		resp, err := client.Do(req)
		if err != nil {
			cancel()
			t.Fatalf("iter %d: request failed: %v", i, err)
		}
		if resp.StatusCode != http.StatusOK {
			_ = resp.Body.Close()
			cancel()
			t.Fatalf("iter %d: status = %d, want 200", i, resp.StatusCode)
		}
		reader := bufio.NewReader(resp.Body)
		line, err := reader.ReadString('\n')
		if err != nil || !strings.HasPrefix(line, "event: unread") {
			_ = resp.Body.Close()
			cancel()
			t.Fatalf("iter %d: unexpected first line %q, err=%v", i, line, err)
		}
		_ = resp.Body.Close()
		cancel()
		// 给内核与 netpoll 极短事件循环调度窗口完成 EOF 回调与 defer release()
		time.Sleep(10 * time.Millisecond)
	}
}
