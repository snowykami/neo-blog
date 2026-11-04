package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// fakeOidcProvider 模拟身份提供商的令牌与用户信息接口，记录换取令牌时收到的 code_verifier
type fakeOidcProvider struct {
	*httptest.Server
	mu           sync.Mutex
	codeVerifier string
}

func newFakeOidcProvider(t *testing.T) *fakeOidcProvider {
	t.Helper()
	p := &fakeOidcProvider{}
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil || r.PostForm.Get("code") != "auth-code" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		p.mu.Lock()
		p.codeVerifier = r.PostForm.Get("code_verifier")
		p.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access-token","token_type":"Bearer"}`))
	})
	mux.HandleFunc("/userinfo", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer access-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"sub":                "fake-sub-1",
			"name":               "Fake User",
			"email":              "fake-user@idp.test",
			"preferred_username": "fakeuser",
			"email_verified":     true,
		})
	})
	p.Server = httptest.NewServer(mux)
	t.Cleanup(p.Close)
	return p
}

func (p *fakeOidcProvider) receivedVerifier() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.codeVerifier
}

func TestOidcAuthorizeAndLogin(t *testing.T) {
	_, _, other, _, _ := setupEditTest(t)
	provider := newFakeOidcProvider(t)
	if err := repo.Oidc.CreateOidcConfig(&model.OidcConfig{
		Name:                  "fake",
		DisplayName:           "Fake IdP",
		ClientID:              "client-id",
		ClientSecret:          "client-secret",
		Issuer:                provider.URL,
		AuthorizationEndpoint: provider.URL + "/authorize",
		TokenEndpoint:         provider.URL + "/token",
		UserinfoEndpoint:      provider.URL + "/userinfo",
	}); err != nil {
		t.Fatalf("create oidc config: %v", err)
	}
	users := NewUserService()
	guest := context.Background()

	// 列表只含展示信息，不生成 state
	list, svcerr := users.ListOidcConfigs()
	if svcerr != nil || len(list) != 1 || list[0].Name != "fake" || list[0].DisplayName != "Fake IdP" {
		t.Fatalf("list oidc configs: %+v, %v", list, svcerr)
	}

	authorize := func(ctx context.Context, req *dto.OidcAuthorizeReq) url.Values {
		t.Helper()
		authorizeUrl, svcerr := users.OidcAuthorize(ctx, req)
		if svcerr != nil {
			t.Fatalf("authorize: %v", svcerr)
		}
		u, err := url.Parse(authorizeUrl)
		if err != nil || u.Path != "/authorize" {
			t.Fatalf("authorize url: %s", authorizeUrl)
		}
		return u.Query()
	}

	// 点击登录时才生成 state，并附带 PKCE（S256）
	query := authorize(guest, &dto.OidcAuthorizeReq{Name: "fake", RedirectBack: "/p/1", BrowserNonce: "nonce-a"})
	if query.Get("state") == "" || query.Get("code_challenge_method") != "S256" || query.Get("code_challenge") == "" {
		t.Fatalf("authorize query missing state or pkce: %v", query)
	}
	login := &dto.OidcLoginReq{Name: "fake", Code: "auth-code", State: query.Get("state"), BrowserNonce: "nonce-a"}
	resp, svcerr := users.OidcLogin(guest, login)
	if svcerr != nil || resp.Token == "" || resp.User.Username != "fakeuser" {
		t.Fatalf("oidc login: %+v, %v", resp, svcerr)
	}
	if login.RedirectBack != "/p/1" {
		t.Fatalf("redirect back should come from state, got %q", login.RedirectBack)
	}
	if got := provider.receivedVerifier(); got == "" || utils.Oidc.PkceChallenge(got) != query.Get("code_challenge") {
		t.Fatalf("token request should carry the verifier matching the challenge, got %q", got)
	}

	// state 只能用一次
	_, svcerr = users.OidcLogin(guest, &dto.OidcLoginReq{Name: "fake", Code: "auth-code", State: query.Get("state"), BrowserNonce: "nonce-a"})
	if svcerr == nil || svcerr.Message != "invalid_oidc_state" {
		t.Fatalf("replayed state should be rejected, got %v", svcerr)
	}

	// 回调必须来自发起登录的同一浏览器
	query = authorize(guest, &dto.OidcAuthorizeReq{Name: "fake", RedirectBack: "/", BrowserNonce: "nonce-a"})
	_, svcerr = users.OidcLogin(guest, &dto.OidcLoginReq{Name: "fake", Code: "auth-code", State: query.Get("state"), BrowserNonce: "nonce-b"})
	if svcerr == nil || svcerr.Message != "invalid_oidc_state" {
		t.Fatalf("nonce mismatch should be rejected, got %v", svcerr)
	}

	// 绑定需要已登录，并记录发起人
	if _, svcerr = users.OidcAuthorize(guest, &dto.OidcAuthorizeReq{Name: "fake", IsBind: true, BrowserNonce: "nonce-a"}); svcerr == nil || svcerr.Message != "login_required" {
		t.Fatalf("guest bind should require login, got %v", svcerr)
	}
	bindReq := &dto.OidcAuthorizeReq{Name: "fake", IsBind: true, BrowserNonce: "nonce-a"}
	authorize(other, bindReq)
	if otherID, _ := ctxutils.GetCurrentUserID(other); bindReq.UserID != otherID {
		t.Fatalf("bind should record the current user, got %d", bindReq.UserID)
	}

	// 停用或不存在的提供商不能发起登录
	if err := repo.GetDB().Model(&model.OidcConfig{}).Where("name = ?", "fake").Update("enabled", false).Error; err != nil {
		t.Fatalf("disable oidc config: %v", err)
	}
	for _, name := range []string{"fake", "missing"} {
		if _, svcerr = users.OidcAuthorize(guest, &dto.OidcAuthorizeReq{Name: name, BrowserNonce: "nonce-a"}); svcerr == nil || svcerr.Message != "invalid_oidc_name" {
			t.Fatalf("authorize %s should fail with invalid_oidc_name, got %v", name, svcerr)
		}
	}
	if list, _ = users.ListOidcConfigs(); len(list) != 0 {
		t.Fatalf("disabled provider should not be listed, got %+v", list)
	}
}

func TestOidcErrorPageUrl(t *testing.T) {
	users := NewUserService()
	cases := map[string]string{
		"/p/1?tab=comments": "/auth/login?oidc_error=invalid_oidc_state&redirect_back=%2Fp%2F1%3Ftab%3Dcomments",
		"//evil.example":    "/auth/login?oidc_error=invalid_oidc_state&redirect_back=%2F",
		"/\\evil.example":   "/auth/login?oidc_error=invalid_oidc_state&redirect_back=%2F",
		"https://evil.test": "/auth/login?oidc_error=invalid_oidc_state&redirect_back=%2F",
		"":                  "/auth/login?oidc_error=invalid_oidc_state&redirect_back=%2F",
	}
	for redirectBack, want := range cases {
		if got := users.OidcErrorPageUrl(redirectBack, "invalid_oidc_state"); got != want {
			t.Errorf("OidcErrorPageUrl(%q) = %q, want %q", redirectBack, got, want)
		}
	}
}
