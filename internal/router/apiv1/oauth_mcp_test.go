package apiv1

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func startOAuthMCPServer(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()

	h := server.New(
		server.WithHostPorts(addr),
		server.WithStreamBody(true),
		server.WithSenseClientDisconnection(true),
		server.WithExitWaitTime(0),
	)
	h.Use(
		middleware.UseCookieCSRF(),
		middleware.UseFileLinks(),
	)
	corsGet := middleware.UsePublicCORS("GET", "HEAD", "OPTIONS")
	wk := h.Group("/.well-known")
	wk.Use(corsGet)
	{
		wk.GET("/oauth-protected-resource", controller.OAuth.ProtectedResourceMetadata)
		wk.OPTIONS("/oauth-protected-resource", corsGet)
		wk.GET("/oauth-protected-resource/*filepath", controller.OAuth.ProtectedResourceMetadata)
		wk.GET("/oauth-authorization-server", controller.OAuth.AuthorizationServerMetadata)
		wk.OPTIONS("/oauth-authorization-server", corsGet)
		wk.GET("/oauth-authorization-server/*filepath", controller.OAuth.AuthorizationServerMetadata)
	}
	v1 := h.Group("/api/v1")
	registerMCPRoutes(v1)
	registerOAuthRoutes(v1)

	go func() { _ = h.Run() }()
	t.Cleanup(func() { _ = h.Shutdown(context.Background()) })
	for range 50 {
		if conn, err := net.Dial("tcp", addr); err == nil {
			_ = conn.Close()
			return "http://" + addr
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("oauth mcp server did not start")
	return ""
}

func pkceS256Challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func TestMCPOAuth21EndToEnd(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "oauth_mcp.db"))
	t.Setenv("BASE_URL", "")
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}

	editor := &model.User{Username: "editor_oauth", Email: "editor@oauth.local", Role: constant.RoleEditor}
	regularUser := &model.User{Username: "reader_oauth", Email: "reader@oauth.local", Role: constant.RoleUser}
	aiUser := &model.User{Username: "ai_oauth", Email: "ai@oauth.local", Role: constant.RoleUser, IsAI: true}
	for _, u := range []*model.User{editor, regularUser, aiUser} {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatalf("create user %s: %v", u.Username, err)
		}
	}

	baseURL := startOAuthMCPServer(t)
	mcpEndpoint := baseURL + "/api/v1/mcp"

	// 1. 未认证请求 /api/v1/mcp 返回 401 + RFC 9728 WWW-Authenticate 头（不含 invalid_token），OPTIONS 预检返回 204 并暴露 WWW-Authenticate
	optReq, _ := http.NewRequest(http.MethodOptions, mcpEndpoint, nil)
	optResp, err := http.DefaultClient.Do(optReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = optResp.Body.Close()
	if optResp.StatusCode != http.StatusNoContent || !strings.Contains(optResp.Header.Get("Access-Control-Expose-Headers"), "WWW-Authenticate") {
		t.Fatalf("OPTIONS /api/v1/mcp: status=%d expose=%q", optResp.StatusCode, optResp.Header.Get("Access-Control-Expose-Headers"))
	}

	unauthReq, _ := http.NewRequest(http.MethodPost, mcpEndpoint, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`))
	unauthReq.Header.Set("Content-Type", "application/json")
	unauthResp, err := http.DefaultClient.Do(unauthReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = unauthResp.Body.Close()
	wwwAuth := unauthResp.Header.Get("WWW-Authenticate")
	wantMetaURL := baseURL + "/.well-known/oauth-protected-resource"
	if unauthResp.StatusCode != http.StatusUnauthorized ||
		!strings.Contains(wwwAuth, `resource_metadata="`+wantMetaURL+`"`) ||
		strings.Contains(wwwAuth, "invalid_token") {
		t.Fatalf("unauthenticated MCP 401 header = %q, status = %d", wwwAuth, unauthResp.StatusCode)
	}

	// 2. 元数据自动发现端点（根路径与 /api/v1/mcp 子路径）及 Cache-Control: no-store
	for _, wkPath := range []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/v1/mcp"} {
		resp, err := http.Get(baseURL + wkPath)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("GET %s: status=%d cache-control=%q", wkPath, resp.StatusCode, resp.Header.Get("Cache-Control"))
		}
		var meta dto.OAuthProtectedResourceMetadata
		if err := json.Unmarshal(body, &meta); err != nil {
			t.Fatal(err)
		}
		if meta.Resource != mcpEndpoint || len(meta.AuthorizationServers) != 1 || meta.AuthorizationServers[0] != baseURL {
			t.Fatalf("unexpected protected resource metadata: %+v", meta)
		}
	}

	asResp, err := http.Get(baseURL + "/.well-known/oauth-authorization-server")
	if err != nil {
		t.Fatal(err)
	}
	asBody, _ := io.ReadAll(asResp.Body)
	_ = asResp.Body.Close()
	var asMeta dto.OAuthAuthorizationServerMetadata
	if err := json.Unmarshal(asBody, &asMeta); err != nil {
		t.Fatal(err)
	}
	if asMeta.Issuer != baseURL ||
		asMeta.AuthorizationEndpoint != baseURL+"/oauth/authorize" ||
		asMeta.TokenEndpoint != baseURL+"/api/v1/oauth/token" ||
		asMeta.RegistrationEndpoint != baseURL+"/api/v1/oauth/register" ||
		asMeta.RevocationEndpoint != baseURL+"/api/v1/oauth/revoke" {
		t.Fatalf("unexpected authorization server metadata: %+v", asMeta)
	}

	// 验证显式配置 BASE_URL 时完全免疫 X-Forwarded-Host 投毒
	t.Setenv("BASE_URL", "https://blog.sfkm.me")
	poisonReq, _ := http.NewRequest(http.MethodGet, baseURL+"/.well-known/oauth-authorization-server", nil)
	poisonReq.Header.Set("X-Forwarded-Proto", "https")
	poisonReq.Header.Set("X-Forwarded-Host", "evil.attacker.example")
	poisonResp, err := http.DefaultClient.Do(poisonReq)
	if err != nil {
		t.Fatal(err)
	}
	var poisonMeta dto.OAuthAuthorizationServerMetadata
	_ = json.NewDecoder(poisonResp.Body).Decode(&poisonMeta)
	_ = poisonResp.Body.Close()
	if poisonMeta.Issuer != "https://blog.sfkm.me" {
		t.Fatalf("Host header poisoning succeeded: issuer=%q", poisonMeta.Issuer)
	}
	t.Setenv("BASE_URL", "")

	// 3. 动态客户端注册（DCR）：拦截危险 redirect_uri，支持公共客户端 loopback 与桌面自定义 scheme，以及机密客户端 Basic 认证
	for _, badURI := range []string{
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"http://evil.example.com/callback",
		"https://192.168.1.10/callback",
		"http://127.0.0.1:8787/callback#frag",
	} {
		payload, _ := json.Marshal(map[string]any{
			"client_name":                "Bad Client",
			"redirect_uris":              []string{badURI},
			"token_endpoint_auth_method": "none",
		})
		r, err := http.Post(baseURL+"/api/v1/oauth/register", "application/json", bytes.NewReader(payload))
		if err != nil {
			t.Fatal(err)
		}
		_ = r.Body.Close()
		if r.StatusCode != http.StatusBadRequest {
			t.Fatalf("bad redirect_uri %q should fail with 400, got %d", badURI, r.StatusCode)
		}
	}

	// 注册公共客户端（含无端口 loopback 与 cursor:// 原生桌面回调）
	regPayload, _ := json.Marshal(map[string]any{
		"client_name":                "Antigravity Desktop",
		"redirect_uris":              []string{"http://127.0.0.1/callback", "cursor://anysphere.cursor-mcp/oauth/callback"},
		"token_endpoint_auth_method": "none",
	})
	regResp, err := http.Post(baseURL+"/api/v1/oauth/register", "application/json", bytes.NewReader(regPayload))
	if err != nil {
		t.Fatal(err)
	}
	regBody, _ := io.ReadAll(regResp.Body)
	_ = regResp.Body.Close()
	if regResp.StatusCode != http.StatusCreated {
		t.Fatalf("DCR expected 201, got %d: %s", regResp.StatusCode, string(regBody))
	}
	var pubClient dto.OAuthClientRegistrationResp
	if err := json.Unmarshal(regBody, &pubClient); err != nil {
		t.Fatal(err)
	}
	if pubClient.ClientID == "" || pubClient.ClientSecret != "" {
		t.Fatalf("unexpected public client registration: %+v", pubClient)
	}

	// 4. 授权校验与安全边界：防 Open Redirect（拒绝未注册回调）、拦截 AI 用户与双头混用、角色权限自动收敛、RFC 8252 动态端口兼容
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk_valid_pkce_verifier"
	challenge := pkceS256Challenge(verifier)
	dynamicCallback := "http://127.0.0.1:54321/callback"
	editorCookie := loginCookie(t, editor)

	// 拒绝分支若传入未注册的 redirect_uri，必须返回 400 而不是生成跳转地址（防 Open Redirect）
	evilDenyBody, _ := json.Marshal(map[string]any{
		"approve":               false,
		"client_id":             pubClient.ClientID,
		"redirect_uri":          "https://evil.example.com/steal",
		"response_type":         "code",
		"state":                 "st1",
		"code_challenge":        challenge,
		"code_challenge_method": "S256",
	})
	evilDenyReq, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/oauth/authorize", bytes.NewReader(evilDenyBody))
	evilDenyReq.Header.Set("Content-Type", "application/json")
	evilDenyReq.Header.Set("Cookie", editorCookie)
	evilDenyResp, err := http.DefaultClient.Do(evilDenyReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = evilDenyResp.Body.Close()
	if evilDenyResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unregistered redirect_uri on deny must return 400, got %d", evilDenyResp.StatusCode)
	}

	// 合法拒绝分支返回 access_denied 与原样 state
	validDenyBody, _ := json.Marshal(map[string]any{
		"approve":               false,
		"client_id":             pubClient.ClientID,
		"redirect_uri":          dynamicCallback,
		"response_type":         "code",
		"state":                 "deny_state_42",
		"code_challenge":        challenge,
		"code_challenge_method": "S256",
	})
	validDenyReq, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/oauth/authorize", bytes.NewReader(validDenyBody))
	validDenyReq.Header.Set("Content-Type", "application/json")
	validDenyReq.Header.Set("Cookie", editorCookie)
	validDenyResp, err := http.DefaultClient.Do(validDenyReq)
	if err != nil {
		t.Fatal(err)
	}
	var denyWrapper struct {
		Data dto.OAuthAuthorizeDecisionResp `json:"data"`
	}
	_ = json.NewDecoder(validDenyResp.Body).Decode(&denyWrapper)
	_ = validDenyResp.Body.Close()
	denyParsed, err := url.Parse(denyWrapper.Data.RedirectURL)
	if err != nil || denyParsed.Query().Get("error") != "access_denied" || denyParsed.Query().Get("state") != "deny_state_42" {
		t.Fatalf("unexpected deny redirect url: %q", denyWrapper.Data.RedirectURL)
	}

	// AI 用户与同时带 Authorization 头的请求必须被拒绝（403）
	aiAuthorizeReq, _ := http.NewRequest(http.MethodGet, baseURL+"/api/v1/oauth/authorize/info?client_id="+pubClient.ClientID+"&redirect_uri="+url.QueryEscape(dynamicCallback)+"&response_type=code&code_challenge="+challenge+"&code_challenge_method=S256", nil)
	aiAuthorizeReq.Header.Set("Cookie", loginCookie(t, aiUser))
	aiResp, _ := http.DefaultClient.Do(aiAuthorizeReq)
	_ = aiResp.Body.Close()
	if aiResp.StatusCode != http.StatusForbidden {
		t.Fatalf("AI user should be forbidden from OAuth authorize, got %d", aiResp.StatusCode)
	}

	dualHeaderReq, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/oauth/authorize", bytes.NewReader(validDenyBody))
	dualHeaderReq.Header.Set("Content-Type", "application/json")
	dualHeaderReq.Header.Set("Cookie", editorCookie)
	dualHeaderReq.Header.Set("Authorization", "Bearer anything")
	dualResp, _ := http.DefaultClient.Do(dualHeaderReq)
	_ = dualResp.Body.Close()
	if dualResp.StatusCode != http.StatusForbidden {
		t.Fatalf("dual Cookie + Authorization header on authorize must return 403, got %d", dualResp.StatusCode)
	}

	// Editor 请求包含管理员专属 ai_agents:write 时，info 接口应将其归入 unavailable_scopes 并只授予 editor 允许的范围
	infoURL := baseURL + "/api/v1/oauth/authorize/info?" + url.Values{
		"client_id":             {pubClient.ClientID},
		"redirect_uri":          {dynamicCallback},
		"response_type":         {"code"},
		"scope":                 {"posts:read posts:write ai_agents:write"},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"resource":              {mcpEndpoint},
	}.Encode()
	infoReq, _ := http.NewRequest(http.MethodGet, infoURL, nil)
	infoReq.Header.Set("Cookie", editorCookie)
	infoResp, err := http.DefaultClient.Do(infoReq)
	if err != nil {
		t.Fatal(err)
	}
	var infoWrapper struct {
		Data dto.OAuthAuthorizeInfoResp `json:"data"`
	}
	_ = json.NewDecoder(infoResp.Body).Decode(&infoWrapper)
	_ = infoResp.Body.Close()
	if infoResp.StatusCode != http.StatusOK ||
		strings.Join(infoWrapper.Data.GrantedScopes, ",") != "posts:read,posts:write" ||
		strings.Join(infoWrapper.Data.UnavailableScopes, ",") != "ai_agents:write" {
		t.Fatalf("unexpected authorize info scope intersection: %+v", infoWrapper.Data)
	}

	// 普通用户尝试仅请求管理员权限时应直接返回 403
	escalateURL := baseURL + "/api/v1/oauth/authorize/info?" + url.Values{
		"client_id":             {pubClient.ClientID},
		"redirect_uri":          {dynamicCallback},
		"response_type":         {"code"},
		"scope":                 {"ai_agents:write"},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}.Encode()
	escalateReq, _ := http.NewRequest(http.MethodGet, escalateURL, nil)
	escalateReq.Header.Set("Cookie", loginCookie(t, regularUser))
	escalateResp, _ := http.DefaultClient.Do(escalateReq)
	_ = escalateResp.Body.Close()
	if escalateResp.StatusCode != http.StatusForbidden {
		t.Fatalf("privilege escalation scope request must return 403, got %d", escalateResp.StatusCode)
	}

	// 辅助函数：批准授权并拿到一次性 code
	issueCodeForEditor := func(codeChallengeVal string) string {
		t.Helper()
		approveBody, _ := json.Marshal(map[string]any{
			"approve":               true,
			"client_id":             pubClient.ClientID,
			"redirect_uri":          dynamicCallback,
			"response_type":         "code",
			"scope":                 "posts:read posts:write",
			"state":                 "ok_state_1",
			"code_challenge":        codeChallengeVal,
			"code_challenge_method": "S256",
			"resource":              mcpEndpoint,
		})
		req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/oauth/authorize", bytes.NewReader(approveBody))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Cookie", editorCookie)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var wrap struct {
			Data dto.OAuthAuthorizeDecisionResp `json:"data"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&wrap)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("approve failed with %d", resp.StatusCode)
		}
		u, err := url.Parse(wrap.Data.RedirectURL)
		if err != nil || u.Query().Get("state") != "ok_state_1" || u.Query().Get("code") == "" {
			t.Fatalf("invalid redirect url: %q", wrap.Data.RedirectURL)
		}
		return u.Query().Get("code")
	}

	// 5. PKCE S256 校验：错误的 code_verifier 必须拒绝且同时销毁一次性授权码
	badCode := issueCodeForEditor(challenge)
	wrongForm := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {pubClient.ClientID},
		"code":          {badCode},
		"redirect_uri":  {dynamicCallback},
		"code_verifier": {"wrong_verifier_with_at_least_43_characters_padding_12345"},
	}
	wrongResp, err := http.PostForm(baseURL+"/api/v1/oauth/token", wrongForm)
	if err != nil {
		t.Fatal(err)
	}
	var oauthErr dto.OAuthErrorResp
	_ = json.NewDecoder(wrongResp.Body).Decode(&oauthErr)
	_ = wrongResp.Body.Close()
	if wrongResp.StatusCode != http.StatusBadRequest || oauthErr.Error != "invalid_grant" {
		t.Fatalf("wrong PKCE verifier should fail with 400 invalid_grant, got %d %+v", wrongResp.StatusCode, oauthErr)
	}
	// 用正确 verifier 再试已被销毁的 badCode 仍须失败
	wrongForm.Set("code_verifier", verifier)
	retryBurnedResp, _ := http.PostForm(baseURL+"/api/v1/oauth/token", wrongForm)
	_ = retryBurnedResp.Body.Close()
	if retryBurnedResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("burned code must not be reusable, got %d", retryBurnedResp.StatusCode)
	}

	// 6. 正常换票（x-www-form-urlencoded）+ 授权码重放时连带吊销已签发令牌族
	replayCode := issueCodeForEditor(challenge)
	validForm := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {pubClient.ClientID},
		"code":          {replayCode},
		"redirect_uri":  {dynamicCallback},
		"code_verifier": {verifier},
		"resource":      {mcpEndpoint},
	}
	tokResp1, err := http.PostForm(baseURL+"/api/v1/oauth/token", validForm)
	if err != nil {
		t.Fatal(err)
	}
	var tokenSet1 dto.OAuthTokenResp
	_ = json.NewDecoder(tokResp1.Body).Decode(&tokenSet1)
	_ = tokResp1.Body.Close()
	if tokResp1.StatusCode != http.StatusOK || !strings.HasPrefix(tokenSet1.AccessToken, constant.OAuthAccessTokenPrefix) || tokenSet1.RefreshToken == "" {
		t.Fatalf("token exchange failed: status=%d %+v", tokResp1.StatusCode, tokenSet1)
	}
	// 重放同一授权码：不仅自身返回 400 invalid_grant，还会使刚才签发的 tokenSet1.AccessToken 立即失效！
	replayResp, _ := http.PostForm(baseURL+"/api/v1/oauth/token", validForm)
	_ = replayResp.Body.Close()
	if replayResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("replayed code must return 400, got %d", replayResp.StatusCode)
	}
	mcpAfterCodeReplayReq, _ := http.NewRequest(http.MethodPost, mcpEndpoint, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	mcpAfterCodeReplayReq.Header.Set("Content-Type", "application/json")
	mcpAfterCodeReplayReq.Header.Set("Authorization", "Bearer "+tokenSet1.AccessToken)
	mcpAfterCodeReplayResp, _ := http.DefaultClient.Do(mcpAfterCodeReplayReq)
	_ = mcpAfterCodeReplayResp.Body.Close()
	if mcpAfterCodeReplayResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("access token from replayed authorization code should be revoked (401), got %d", mcpAfterCodeReplayResp.StatusCode)
	}

	// 7. 使用新签发的 OAuth Access Token 跑通完整 MCP SDK 调用（含与浏览器活跃编辑会话并发写入 + 版本历史无外键冲突）
	goodCode := issueCodeForEditor(challenge)
	jsonExchange, _ := json.Marshal(map[string]any{
		"grant_type":    "authorization_code",
		"client_id":     pubClient.ClientID,
		"code":          goodCode,
		"redirect_uri":  dynamicCallback,
		"code_verifier": verifier,
	})
	tokResp2, err := http.Post(baseURL+"/api/v1/oauth/token", "application/json", bytes.NewReader(jsonExchange))
	if err != nil {
		t.Fatal(err)
	}
	var tokenSet2 dto.OAuthTokenResp
	_ = json.NewDecoder(tokResp2.Body).Decode(&tokenSet2)
	_ = tokResp2.Body.Close()
	if tokResp2.StatusCode != http.StatusOK {
		t.Fatalf("JSON token exchange failed: %d", tokResp2.StatusCode)
	}

	ctx := context.Background()
	mcpClient := mcp.NewClient(&mcp.Implementation{Name: "oauth-test", Version: "1.0"}, nil)
	session, err := mcpClient.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:             mcpEndpoint,
		HTTPClient:           &http.Client{Transport: bearerTransport{tokenSet2.AccessToken}},
		DisableStandaloneSSE: true,
		MaxRetries:           -1,
	}, nil)
	if err != nil {
		t.Fatalf("connect MCP with OAuth access token: %v", err)
	}
	defer session.Close()

	createRes, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name:      "create_post",
		Arguments: map[string]any{"title": "OAuth Post", "content": "Initial draft paragraph."},
	})
	if err != nil || createRes.IsError {
		t.Fatalf("create_post with OAuth token failed: %v %s", err, contentText(createRes))
	}
	var createdPost model.Post
	if err := repo.GetDB().Where("title = ?", "OAuth Post").First(&createdPost).Error; err != nil || createdPost.UserID != editor.ID {
		t.Fatalf("created post mismatch: %v %+v", err, createdPost)
	}

	// 模拟编辑器中已打开活跃浏览器会话，验证 OAuth 令牌调用 update_post 不会误触发 409 edit_session_taken_over 且正常记录修订
	editAuthCtx := context.WithValue(context.Background(), "user_id", editor.ID)
	if _, svcerr := service.NewEditSessionService().Acquire(editAuthCtx, "post", createdPost.ID, "browser-tab-session-1"); svcerr != nil {
		t.Fatalf("acquire browser edit session: %v", svcerr)
	}

	listRes, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "list_posts", Arguments: map[string]any{}})
	if err != nil || listRes.IsError {
		t.Fatalf("list_posts with OAuth token failed: %v %s", err, contentText(listRes))
	}

	updateRes, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name: "update_post",
		Arguments: map[string]any{
			"post_id":   createdPost.ID,
			"edit_mode": "append",
			"content":   "\n\nAppended via MCP OAuth 2.1.",
		},
	})
	if err != nil || updateRes.IsError {
		t.Fatalf("update_post with OAuth token while browser session active failed: %v %s", err, contentText(updateRes))
	}

	// 未授予 posts:publish 时调用 publish_post 应被拦截
	pubRes, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name:      "publish_post",
		Arguments: map[string]any{"post_id": createdPost.ID},
	})
	if err != nil || !pubRes.IsError || !strings.Contains(contentText(pubRes), constant.ScopePostsPublish) {
		t.Fatalf("publish_post without posts:publish scope should fail cleanly: %v %s", err, contentText(pubRes))
	}

	// 8. Refresh Token 轮换、旧 Refresh Token 重放吊销令牌族，以及 /api/v1/oauth/revoke 主动吊销
	refreshForm := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {pubClient.ClientID},
		"refresh_token": {tokenSet2.RefreshToken},
	}
	rotResp, err := http.PostForm(baseURL+"/api/v1/oauth/token", refreshForm)
	if err != nil {
		t.Fatal(err)
	}
	var rotated dto.OAuthTokenResp
	_ = json.NewDecoder(rotResp.Body).Decode(&rotated)
	_ = rotResp.Body.Close()
	if rotResp.StatusCode != http.StatusOK || rotated.AccessToken == tokenSet2.AccessToken || rotated.RefreshToken == tokenSet2.RefreshToken {
		t.Fatalf("refresh token rotation failed: status=%d %+v", rotResp.StatusCode, rotated)
	}

	// 先测试主动吊销新签发的 Access Token：首先用新令牌组再续期一次以测试 revoke，随后验证旧 refresh 重放吊销全族
	rotForm2 := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {pubClient.ClientID},
		"refresh_token": {rotated.RefreshToken},
	}
	rotResp2, _ := http.PostForm(baseURL+"/api/v1/oauth/token", rotForm2)
	var rotated2 dto.OAuthTokenResp
	_ = json.NewDecoder(rotResp2.Body).Decode(&rotated2)
	_ = rotResp2.Body.Close()

	// 重放已被消费过的旧 tokenSet2.RefreshToken：必须返回 400 invalid_grant 并连坐吊销最新的 rotated2.AccessToken！
	replayRefreshResp, _ := http.PostForm(baseURL+"/api/v1/oauth/token", refreshForm)
	_ = replayRefreshResp.Body.Close()
	if replayRefreshResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("replayed refresh_token must return 400, got %d", replayRefreshResp.StatusCode)
	}
	checkRevokedReq, _ := http.NewRequest(http.MethodPost, mcpEndpoint, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	checkRevokedReq.Header.Set("Content-Type", "application/json")
	checkRevokedReq.Header.Set("Authorization", "Bearer "+rotated2.AccessToken)
	checkRevokedResp, _ := http.DefaultClient.Do(checkRevokedReq)
	_ = checkRevokedResp.Body.Close()
	if checkRevokedResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("refresh token replay must revoke active family tokens (want 401, got %d)", checkRevokedResp.StatusCode)
	}

	// 验证 POST /api/v1/oauth/revoke 主动吊销
	revokeCode := issueCodeForEditor(challenge)
	tokResp3, _ := http.PostForm(baseURL+"/api/v1/oauth/token", url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {pubClient.ClientID},
		"code":          {revokeCode},
		"redirect_uri":  {dynamicCallback},
		"code_verifier": {verifier},
	})
	var tokenSet3 dto.OAuthTokenResp
	_ = json.NewDecoder(tokResp3.Body).Decode(&tokenSet3)
	_ = tokResp3.Body.Close()

	revResp, err := http.PostForm(baseURL+"/api/v1/oauth/revoke", url.Values{
		"client_id": {pubClient.ClientID},
		"token":     {tokenSet3.RefreshToken},
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = revResp.Body.Close()
	if revResp.StatusCode != http.StatusOK {
		t.Fatalf("revoke expected 200, got %d", revResp.StatusCode)
	}
	afterRevokeReq, _ := http.NewRequest(http.MethodPost, mcpEndpoint, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	afterRevokeReq.Header.Set("Content-Type", "application/json")
	afterRevokeReq.Header.Set("Authorization", "Bearer "+tokenSet3.AccessToken)
	afterRevokeResp, _ := http.DefaultClient.Do(afterRevokeReq)
	_ = afterRevokeResp.Body.Close()
	if afterRevokeResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked refresh token must invalidate family access token, got %d", afterRevokeResp.StatusCode)
	}

	// 9. 验证机密客户端（默认 client_secret_basic 注册）同时兼容 HTTP Basic 与 client_secret_post，且错误密钥返回 401
	confRegPayload, _ := json.Marshal(map[string]any{
		"client_name":   "Confidential MCP Bridge",
		"redirect_uris": []string{"https://mcp.example.com/oauth/callback"},
	})
	confRegResp, err := http.Post(baseURL+"/api/v1/oauth/register", "application/json", bytes.NewReader(confRegPayload))
	if err != nil {
		t.Fatal(err)
	}
	var confClient dto.OAuthClientRegistrationResp
	_ = json.NewDecoder(confRegResp.Body).Decode(&confClient)
	_ = confRegResp.Body.Close()
	if confRegResp.StatusCode != http.StatusCreated || confClient.ClientSecret == "" || confClient.TokenEndpointAuthMethod != model.OAuthAuthMethodClientSecretBasic {
		t.Fatalf("confidential DCR failed: status=%d %+v", confRegResp.StatusCode, confClient)
	}

	issueConfCode := func() string {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"approve":               true,
			"client_id":             confClient.ClientID,
			"redirect_uri":          "https://mcp.example.com/oauth/callback",
			"response_type":         "code",
			"code_challenge":        challenge,
			"code_challenge_method": "S256",
		})
		req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/oauth/authorize", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Cookie", editorCookie)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var wrap struct {
			Data dto.OAuthAuthorizeDecisionResp `json:"data"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&wrap)
		_ = resp.Body.Close()
		u, _ := url.Parse(wrap.Data.RedirectURL)
		return u.Query().Get("code")
	}

	// 错误密钥 -> 401 invalid_client + WWW-Authenticate: Basic
	badBasicReq, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/oauth/token", strings.NewReader(url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {issueConfCode()},
		"redirect_uri":  {"https://mcp.example.com/oauth/callback"},
		"code_verifier": {verifier},
	}.Encode()))
	badBasicReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	badBasicReq.SetBasicAuth(confClient.ClientID, "wrong_secret")
	badBasicResp, _ := http.DefaultClient.Do(badBasicReq)
	_ = badBasicResp.Body.Close()
	if badBasicResp.StatusCode != http.StatusUnauthorized || !strings.HasPrefix(badBasicResp.Header.Get("WWW-Authenticate"), "Basic") {
		t.Fatalf("wrong Basic secret expected 401 Basic challenge, got %d %q", badBasicResp.StatusCode, badBasicResp.Header.Get("WWW-Authenticate"))
	}

	// HTTP Basic 换票成功，且刷新时改用 client_secret_post 也兼容成功
	goodBasicReq, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/oauth/token", strings.NewReader(url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {issueConfCode()},
		"redirect_uri":  {"https://mcp.example.com/oauth/callback"},
		"code_verifier": {verifier},
	}.Encode()))
	goodBasicReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	goodBasicReq.SetBasicAuth(url.PathEscape(confClient.ClientID), url.PathEscape(confClient.ClientSecret))
	goodBasicResp, err := http.DefaultClient.Do(goodBasicReq)
	if err != nil {
		t.Fatal(err)
	}
	var confTok dto.OAuthTokenResp
	_ = json.NewDecoder(goodBasicResp.Body).Decode(&confTok)
	_ = goodBasicResp.Body.Close()
	if goodBasicResp.StatusCode != http.StatusOK || confTok.AccessToken == "" {
		t.Fatalf("confidential Basic exchange failed: status=%d %+v", goodBasicResp.StatusCode, confTok)
	}

	postAuthRefreshResp, err := http.PostForm(baseURL+"/api/v1/oauth/token", url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {confClient.ClientID},
		"client_secret": {confClient.ClientSecret},
		"refresh_token": {confTok.RefreshToken},
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = postAuthRefreshResp.Body.Close()
	if postAuthRefreshResp.StatusCode != http.StatusOK {
		t.Fatalf("confidential client_secret_post fallback failed: %d", postAuthRefreshResp.StatusCode)
	}
}
