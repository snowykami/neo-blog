package apiv1

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 版本删除接口：鉴权、请求体校验、编辑会话请求头与受保护版本，以及 batch-delete 与 :rid 路由共存
func TestRevisionDeleteRoutes(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	author := &model.User{Username: "author", Email: "author@test.local", Role: constant.RoleEditor}
	other := &model.User{Username: "other", Email: "other@test.local", Role: constant.RoleEditor}
	repo.GetDB().Create(author)
	repo.GetDB().Create(other)
	ctx := context.WithValue(context.Background(), "user_id", author.ID)
	pageID, svcerr := service.NewPageService().CreatePage(ctx, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "关于", Slug: "about", Content: "<p>hi</p>"}})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	session, svcerr := service.NewEditSessionService().Acquire(ctx, constant.TargetTypePage, pageID, "test")
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	// 编辑起点之后的三个版本，最后一个是最新版本（受保护）
	var ids []uint
	for i := range 3 {
		revision := &model.ContentRevision{TargetType: constant.TargetTypePage, TargetID: pageID, Kind: "autosave", UserID: author.ID, Content: fmt.Sprintf("<p>%d</p>", i), Meta: "{}"}
		if err := repo.Revision.Create(revision); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, revision.ID)
	}

	revisionsURL := fmt.Sprintf("%s/page/p/%d/revisions", startPageServer(t), pageID)
	authorCookie, otherCookie := loginCookie(t, author), loginCookie(t, other)
	type result struct {
		Status  int
		Message string
		Data    json.RawMessage
	}
	do := func(method, url, cookie, sessionID, body string) result {
		t.Helper()
		req, _ := http.NewRequest(method, url, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		if sessionID != "" {
			req.Header.Set("X-Edit-Session", sessionID)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out result
		_ = json.NewDecoder(resp.Body).Decode(&out)
		out.Status = resp.StatusCode
		return out
	}
	batch := revisionsURL + "/batch-delete"
	body := func(ids ...uint) string {
		raw, _ := json.Marshal(map[string][]uint{"revision_ids": ids})
		return string(raw)
	}

	for name, c := range map[string]struct {
		cookie, session, body string
		status                int
		message               string
	}{
		"unauthenticated": {"", session.SessionID, body(ids[0]), http.StatusUnauthorized, ""},
		"other editor":    {otherCookie, session.SessionID, body(ids[0]), http.StatusForbidden, ""},
		"malformed body":  {authorCookie, session.SessionID, `{"revision_ids":"x"}`, http.StatusBadRequest, ""},
		"missing ids":     {authorCookie, session.SessionID, `{}`, http.StatusBadRequest, "invalid_request_parameters"},
		"protected":       {authorCookie, session.SessionID, body(ids[0], ids[2]), http.StatusBadRequest, "revision_protected"},
		"stale session":   {authorCookie, "stale-session", body(ids[0]), http.StatusConflict, "edit_session_taken_over"},
	} {
		got := do(http.MethodPost, batch, c.cookie, c.session, c.body)
		if got.Status != c.status || (c.message != "" && got.Message != c.message) {
			t.Fatalf("%s: got %d %q, want %d %q", name, got.Status, got.Message, c.status, c.message)
		}
	}

	// 批量删除成功，返回实际删除的数量
	got := do(http.MethodPost, batch, authorCookie, session.SessionID, body(ids[0]))
	var deleted dto.DeleteRevisionResp
	_ = json.Unmarshal(got.Data, &deleted)
	if got.Status != http.StatusOK || deleted.Deleted != 1 {
		t.Fatalf("batch delete: %d %s", got.Status, got.Data)
	}
	// 单个删除；再次删除返回 404
	single := fmt.Sprintf("%s/%d", revisionsURL, ids[1])
	if got := do(http.MethodDelete, single, authorCookie, session.SessionID, ""); got.Status != http.StatusOK {
		t.Fatalf("delete: %d %s", got.Status, got.Message)
	}
	if got := do(http.MethodDelete, single, authorCookie, session.SessionID, ""); got.Status != http.StatusNotFound {
		t.Fatalf("delete again: %d", got.Status)
	}
	if got := do(http.MethodDelete, fmt.Sprintf("%s/%d", revisionsURL, ids[2]), authorCookie, session.SessionID, ""); got.Status != http.StatusBadRequest || got.Message != "revision_protected" {
		t.Fatalf("delete latest: %d %q", got.Status, got.Message)
	}

	// 列表：受保护标记与保留上限；详情路由不受 batch-delete 影响
	got = do(http.MethodGet, revisionsURL, authorCookie, "", "")
	var list dto.ListRevisionResp
	_ = json.Unmarshal(got.Data, &list)
	if got.Status != http.StatusOK || list.Total != 2 || list.MaxKeep != 50 ||
		list.Revisions[0].ID != ids[2] || list.Revisions[0].Protected != "latest" || list.Revisions[1].Protected != "base" {
		t.Fatalf("list: %d %s", got.Status, got.Data)
	}
	if got := do(http.MethodGet, fmt.Sprintf("%s/%d", revisionsURL, ids[2]), authorCookie, "", ""); got.Status != http.StatusOK {
		t.Fatalf("get detail: %d", got.Status)
	}
}
