package service

import (
	"context"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// setupAPITokenTest 使用临时 SQLite 数据库，创建普通用户、编辑者与管理员
func setupAPITokenTest(t *testing.T) (user, editor, admin *model.User) {
	t.Helper()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	users := []*model.User{
		{Username: "user", Email: "user@test.local", Role: constant.RoleUser},
		{Username: "editor", Email: "editor@test.local", Role: constant.RoleEditor},
		{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin},
	}
	for _, u := range users {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	return users[0], users[1], users[2]
}

func userCtx(u *model.User) context.Context {
	return context.WithValue(context.Background(), "user_id", u.ID)
}

func createToken(t *testing.T, u *model.User, scopes ...string) *dto.CreateAPITokenResp {
	t.Helper()
	resp, svcerr := NewAPITokenService().Create(userCtx(u), &dto.CreateAPITokenReq{Name: "claude", Scopes: scopes})
	if svcerr != nil {
		t.Fatalf("create token: %v", svcerr)
	}
	return resp
}

func TestHashAPIToken(t *testing.T) {
	a, b := HashAPIToken("nbp_a"), HashAPIToken("nbp_b")
	if len(a) != 64 || a == b || a != HashAPIToken("nbp_a") {
		t.Fatalf("unexpected hashes %q %q", a, b)
	}
}

// 生效权限 = Token 权限范围 ∩ 用户角色；普通用户不能写入或发布文章
func TestEffectiveScopes(t *testing.T) {
	all := []string{constant.ScopePostsRead, constant.ScopePostsWrite, constant.ScopePostsPublish, constant.ScopeFilesWrite, constant.ScopePostsRead}
	cases := map[constant.Role][]string{
		constant.RoleUser:   {constant.ScopePostsRead, constant.ScopeFilesWrite},
		constant.RoleEditor: {constant.ScopePostsRead, constant.ScopePostsWrite, constant.ScopePostsPublish, constant.ScopeFilesWrite},
		constant.RoleAdmin:  {constant.ScopePostsRead, constant.ScopePostsWrite, constant.ScopePostsPublish, constant.ScopeFilesWrite},
		"unknown":           {constant.ScopePostsRead, constant.ScopeFilesWrite},
	}
	for role, want := range cases {
		if got := EffectiveScopes(all, role); !slices.Equal(got, want) {
			t.Errorf("role %s: got %v want %v", role, got, want)
		}
	}
	if got := EffectiveScopes([]string{"admin:all"}, constant.RoleAdmin); len(got) != 0 {
		t.Errorf("unknown scope must never be effective, got %v", got)
	}
}

// 明文只返回一次且库中只存哈希
func TestCreateAPITokenStoresOnlyHash(t *testing.T) {
	_, editor, _ := setupAPITokenTest(t)
	resp := createToken(t, editor, constant.ScopePostsWrite, constant.ScopePostsRead, constant.ScopePostsRead)
	if !strings.HasPrefix(resp.Token, constant.APITokenPrefix) || len(resp.Token) != len(constant.APITokenPrefix)+apiTokenSecretLength {
		t.Fatalf("unexpected token %q", resp.Token)
	}
	stored, err := repo.APIToken.GetByID(resp.APIToken.ID)
	if err != nil {
		t.Fatalf("get token: %v", err)
	}
	if stored.TokenHash != HashAPIToken(resp.Token) || strings.Contains(stored.TokenHash, resp.Token) {
		t.Fatalf("token hash mismatch")
	}
	if stored.Prefix != resp.Token[:apiTokenPrefixLength] {
		t.Fatalf("prefix %q", stored.Prefix)
	}
	// 去重并按固定顺序保存
	if !slices.Equal(stored.ScopeList(), []string{constant.ScopePostsRead, constant.ScopePostsWrite}) {
		t.Fatalf("scopes %v", stored.ScopeList())
	}
	list, svcerr := NewAPITokenService().List(userCtx(editor))
	if svcerr != nil || len(list.APITokens) != 1 || list.APITokens[0].Prefix != stored.Prefix {
		t.Fatalf("list: %v %+v", svcerr, list)
	}
}

func TestCreateAPITokenValidation(t *testing.T) {
	user, editor, _ := setupAPITokenTest(t)
	past := time.Now().Add(-time.Hour)
	cases := []struct {
		name string
		ctx  context.Context
		req  dto.CreateAPITokenReq
		code int
	}{
		{"empty name", userCtx(editor), dto.CreateAPITokenReq{Name: " ", Scopes: []string{constant.ScopePostsRead}}, http.StatusBadRequest},
		{"no scope", userCtx(editor), dto.CreateAPITokenReq{Name: "a"}, http.StatusBadRequest},
		{"unknown scope", userCtx(editor), dto.CreateAPITokenReq{Name: "a", Scopes: []string{"admin:all"}}, http.StatusBadRequest},
		{"expired", userCtx(editor), dto.CreateAPITokenReq{Name: "a", Scopes: []string{constant.ScopePostsRead}, ExpiresAt: &past}, http.StatusBadRequest},
		{"role too low", userCtx(user), dto.CreateAPITokenReq{Name: "a", Scopes: []string{constant.ScopePostsWrite}}, http.StatusForbidden},
		{"guest", context.Background(), dto.CreateAPITokenReq{Name: "a", Scopes: []string{constant.ScopePostsRead}}, http.StatusUnauthorized},
		// Token 不能再创建 Token
		{"via token", ctxutils.WithAPIToken(userCtx(editor), &ctxutils.APITokenInfo{ID: 1}), dto.CreateAPITokenReq{Name: "a", Scopes: []string{constant.ScopePostsRead}}, http.StatusForbidden},
	}
	for _, tc := range cases {
		if _, svcerr := NewAPITokenService().Create(tc.ctx, &tc.req); svcerr == nil || svcerr.Code != tc.code {
			t.Errorf("%s: got %v want %d", tc.name, svcerr, tc.code)
		}
	}
}

func TestAuthenticateAPIToken(t *testing.T) {
	user, editor, admin := setupAPITokenTest(t)
	svc := NewAPITokenService()
	resp := createToken(t, editor, constant.ScopePostsRead, constant.ScopePostsPublish)

	userID, info, svcerr := svc.Authenticate(resp.Token)
	if svcerr != nil || userID != editor.ID || info.ID != resp.APIToken.ID || !slices.Equal(info.Scopes, []string{constant.ScopePostsRead, constant.ScopePostsPublish}) {
		t.Fatalf("authenticate: %v %d %+v", svcerr, userID, info)
	}
	if stored, _ := repo.APIToken.GetByID(resp.APIToken.ID); stored.LastUsedAt == nil {
		t.Fatalf("last_used_at not recorded")
	}

	for _, raw := range []string{"", "nbp_wrong", resp.Token + "x", strings.TrimPrefix(resp.Token, constant.APITokenPrefix)} {
		if _, _, svcerr := svc.Authenticate(raw); svcerr == nil || svcerr.Code != http.StatusUnauthorized {
			t.Errorf("token %q should be invalid, got %v", raw, svcerr)
		}
	}

	// 角色降级后超出角色的权限立即失效
	repo.GetDB().Model(editor).Update("role", constant.RoleUser)
	if _, info, _ := svc.Authenticate(resp.Token); !slices.Equal(info.Scopes, []string{constant.ScopePostsRead}) {
		t.Fatalf("downgraded scopes %v", info.Scopes)
	}
	// 被禁用的用户
	repo.GetDB().Model(editor).Update("disabled", true)
	if _, _, svcerr := svc.Authenticate(resp.Token); svcerr == nil {
		t.Fatalf("disabled user must not authenticate")
	}
	repo.GetDB().Model(editor).Updates(map[string]any{"disabled": false, "role": constant.RoleEditor})

	// 过期
	expired := createToken(t, admin, constant.ScopePostsRead)
	repo.GetDB().Model(&model.APIToken{}).Where("id = ?", expired.APIToken.ID).Update("expires_at", time.Now().Add(-time.Second))
	if _, _, svcerr := svc.Authenticate(expired.Token); svcerr == nil {
		t.Fatalf("expired token must not authenticate")
	}

	// 吊销：其他用户不能吊销，本人可以，管理员也可以
	if svcerr := svc.Revoke(userCtx(user), resp.APIToken.ID); svcerr == nil || svcerr.Code != http.StatusForbidden {
		t.Fatalf("other user revoke: %v", svcerr)
	}
	if svcerr := svc.Revoke(userCtx(admin), resp.APIToken.ID); svcerr != nil {
		t.Fatalf("admin revoke: %v", svcerr)
	}
	if _, _, svcerr := svc.Authenticate(resp.Token); svcerr == nil {
		t.Fatalf("revoked token must not authenticate")
	}
}

func apiTokenCtx(t *testing.T, raw string) context.Context {
	t.Helper()
	userID, info, svcerr := NewAPITokenService().Authenticate(raw)
	if svcerr != nil {
		t.Fatalf("authenticate: %v", svcerr)
	}
	return ctxutils.WithAPIToken(context.WithValue(context.Background(), "user_id", userID), info)
}

// 外部 AI 写入：编辑页活跃时拒绝，沿用自己的会话，编辑页闲置后才接管；版本记录 Token
func TestAcquireForAPIToken(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	authorUser := &model.User{}
	repo.GetDB().First(authorUser, post.UserID)
	token := createToken(t, authorUser, constant.ScopePostsWrite)
	agent := apiTokenCtx(t, token.Token)
	svc := NewEditSessionService()

	// 没有任何会话时直接获取
	sessionID, svcerr := svc.AcquireForAPIToken(agent, constant.TargetTypePost, post.ID)
	if svcerr != nil || sessionID == "" {
		t.Fatalf("first acquire: %v", svcerr)
	}
	again, svcerr := svc.AcquireForAPIToken(agent, constant.TargetTypePost, post.ID)
	if svcerr != nil || again != sessionID {
		t.Fatalf("token should reuse its own session: %q %q %v", sessionID, again, svcerr)
	}
	if svcerr := saveDraft(agent, post.ID, "<p>by agent</p>", sessionID); svcerr != nil {
		t.Fatalf("agent save: %v", svcerr)
	}
	revisions, _, _ := repo.Revision.List(constant.TargetTypePost, post.ID, dto.PaginationParams{})
	if len(revisions) == 0 || revisions[0].APITokenID == nil || *revisions[0].APITokenID != token.APIToken.ID || revisions[0].ToDto().APITokenName != "claude" {
		t.Fatalf("latest revision should record the token: %+v", revisions)
	}

	// 作者在编辑页打开（顶掉 Token 会话），之后 Token 的写入被拒绝
	human, svcerr := svc.Acquire(author, constant.TargetTypePost, post.ID, "browser")
	if svcerr != nil {
		t.Fatalf("human acquire: %v", svcerr)
	}
	if _, svcerr := svc.AcquireForAPIToken(agent, constant.TargetTypePost, post.ID); svcerr == nil || svcerr.Code != http.StatusConflict || svcerr.Message != "edit_session_in_use" {
		t.Fatalf("agent must not take over an active editor: %v", svcerr)
	}
	if svcerr := saveDraft(agent, post.ID, "<p>clobber</p>", sessionID); svcerr == nil {
		t.Fatalf("stale agent session must not write")
	}

	// 编辑页关闭（会话闲置）后可以接管，且编辑页的会话随之失效
	stale := time.Now().Add(-editSessionIdleTimeout - time.Minute)
	repo.GetDB().Model(&model.EditSession{}).Where("session_id = ?", human.SessionID).
		Updates(map[string]any{"active_at": stale, "updated_at": stale})
	taken, svcerr := svc.AcquireForAPIToken(agent, constant.TargetTypePost, post.ID)
	if svcerr != nil || taken == human.SessionID {
		t.Fatalf("agent should take over an idle session: %v", svcerr)
	}
	if svcerr := saveDraft(author, post.ID, "<p>old tab</p>", human.SessionID); svcerr == nil || svcerr.Message != "edit_session_taken_over" {
		t.Fatalf("old editor tab must be told it was taken over: %v", svcerr)
	}
	current, _ := svc.Current(author, constant.TargetTypePost, post.ID, "")
	if current.APITokenName != "claude" {
		t.Fatalf("session holder should show the token name, got %+v", current)
	}

	// 浏览器会话不能走 Token 专用的获取流程
	if _, svcerr := svc.AcquireForAPIToken(author, constant.TargetTypePost, post.ID); svcerr == nil {
		t.Fatalf("non-token ctx must be rejected")
	}
}
