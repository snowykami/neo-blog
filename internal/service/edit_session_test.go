package service

import (
	"context"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
)

// setupEditTest 使用临时 SQLite 数据库，创建作者、管理员、其他编辑者与一篇私密置顶带标签的文章
func setupEditTest(t *testing.T) (author, admin, other context.Context, post *model.Post, label *model.Label) {
	t.Helper()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	users := []*model.User{
		{Username: "author", Email: "author@test.local", Role: constant.RoleEditor},
		{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin},
		{Username: "other", Email: "other@test.local", Role: constant.RoleEditor},
	}
	for _, u := range users {
		if err := repo.GetDB().Create(u).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	ctxOf := func(u *model.User) context.Context { return context.WithValue(context.Background(), "user_id", u.ID) }
	author, admin, other = ctxOf(users[0]), ctxOf(users[1]), ctxOf(users[2])

	label = &model.Label{Name: "go", Slug: "go"}
	if err := repo.GetDB().Create(label).Error; err != nil {
		t.Fatalf("create label: %v", err)
	}
	isPrivate, top := true, uint(5)
	postID, svcerr := NewPostService().CreatePost(author, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{Title: "t", Content: "<p>v1</p>", LabelIds: []uint{label.ID}},
		IsPrivate:   &isPrivate,
		Top:         &top,
	})
	if svcerr != nil {
		t.Fatalf("create post: %v", svcerr)
	}
	post = reloadPost(t, postID)
	return
}

func saveDraft(ctx context.Context, postID uint, content, sessionID string) *errs.ServiceError {
	_, svcerr := NewPostService().UpdatePost(ctx, &dto.CreateOrUpdatePostReq{
		ID:            postID,
		PostBaseDto:   dto.PostBaseDto{DraftContent: &content},
		EditSessionID: sessionID,
	})
	return svcerr
}

func reloadPost(t *testing.T, id uint) *model.Post {
	t.Helper()
	post := &model.Post{}
	if err := repo.GetDB().Preload("Labels").First(post, id).Error; err != nil {
		t.Fatalf("reload post: %v", err)
	}
	return post
}

// 只保存草稿时不能重置私密、置顶与标签
func TestUpdatePostDraftKeepsOtherFields(t *testing.T) {
	author, _, _, post, label := setupEditTest(t)
	if svcerr := saveDraft(author, post.ID, "<p>draft</p>", ""); svcerr != nil {
		t.Fatalf("save draft: %v", svcerr)
	}
	got := reloadPost(t, post.ID)
	if !got.IsPrivate || got.Top != 5 || len(got.Labels) != 1 || got.Labels[0].ID != label.ID {
		t.Fatalf("draft save reset fields: private=%v top=%d labels=%v", got.IsPrivate, got.Top, got.Labels)
	}
	if got.DraftContent == nil || *got.DraftContent != "<p>draft</p>" {
		t.Fatalf("draft not saved: %v", got.DraftContent)
	}

	// 显式传空 label_ids 表示清空标签，显式传 false 才取消私密
	isPrivate := false
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{
		ID:          post.ID,
		PostBaseDto: dto.PostBaseDto{LabelIds: []uint{}},
		IsPrivate:   &isPrivate,
	}); svcerr != nil {
		t.Fatalf("update meta: %v", svcerr)
	}
	got = reloadPost(t, post.ID)
	if got.IsPrivate || len(got.Labels) != 0 || got.Top != 5 {
		t.Fatalf("explicit update not applied: private=%v top=%d labels=%v", got.IsPrivate, got.Top, got.Labels)
	}
}

// 新的编辑会话顶掉旧会话，旧会话不能再保存正文，但可以重新接管
func TestEditSessionTakeOver(t *testing.T) {
	author, admin, other, post, _ := setupEditTest(t)
	svc := NewEditSessionService()

	// 无关的编辑者不能开启会话
	if _, svcerr := svc.Acquire(other, constant.TargetTypePost, post.ID, "ua"); svcerr == nil || svcerr.Code != http.StatusForbidden {
		t.Fatalf("other editor should be forbidden, got %v", svcerr)
	}

	a, svcerr := svc.Acquire(author, constant.TargetTypePost, post.ID, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
	if svcerr != nil || a.SessionID == "" || !a.IsCurrent {
		t.Fatalf("author acquire: %+v %v", a, svcerr)
	}
	if svcerr := saveDraft(author, post.ID, "<p>a1</p>", a.SessionID); svcerr != nil {
		t.Fatalf("author save with own session: %v", svcerr)
	}

	// 管理员在另一台设备打开编辑，顶掉作者
	b, svcerr := svc.Acquire(admin, constant.TargetTypePost, post.ID, "ua-b")
	if svcerr != nil || b.SessionID == a.SessionID {
		t.Fatalf("admin acquire: %+v %v", b, svcerr)
	}
	if svcerr := saveDraft(author, post.ID, "<p>a2</p>", a.SessionID); svcerr == nil || svcerr.Code != http.StatusConflict {
		t.Fatalf("stale session should conflict, got %v", svcerr)
	}
	if svcerr := saveDraft(author, post.ID, "<p>a3</p>", ""); svcerr == nil || svcerr.Code != http.StatusConflict {
		t.Fatalf("content without session should conflict, got %v", svcerr)
	}
	if svcerr := saveDraft(admin, post.ID, "<p>b1</p>", b.SessionID); svcerr != nil {
		t.Fatalf("admin save with current session: %v", svcerr)
	}
	if got := reloadPost(t, post.ID); *got.DraftContent != "<p>b1</p>" {
		t.Fatalf("stale session overwrote draft: %s", *got.DraftContent)
	}

	// 不带正文的修改（如改标题）不受编辑会话限制
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{Title: "new"}}); svcerr != nil {
		t.Fatalf("meta update without content should pass: %v", svcerr)
	}

	// 被顶掉的一方查询时得知已失效，并能看到接管者
	cur, svcerr := svc.Current(author, constant.TargetTypePost, post.ID, a.SessionID)
	if svcerr != nil || cur.IsCurrent || cur.User.Username != "admin" || cur.SessionID != "" {
		t.Fatalf("current for stale session: %+v %v", cur, svcerr)
	}

	// 作者重新接管后，管理员的旧会话失效
	a2, svcerr := svc.Acquire(author, constant.TargetTypePost, post.ID, "ua-a")
	if svcerr != nil {
		t.Fatalf("author re-acquire: %v", svcerr)
	}
	if svcerr := saveDraft(admin, post.ID, "<p>b2</p>", b.SessionID); svcerr == nil || svcerr.Code != http.StatusConflict {
		t.Fatalf("admin stale session should conflict, got %v", svcerr)
	}
	if svcerr := saveDraft(author, post.ID, "<p>a4</p>", a2.SessionID); svcerr != nil {
		t.Fatalf("author save after take over: %v", svcerr)
	}
}

// 编辑、自动保存等写操作不能增加浏览量
func TestUpdatePostKeepsViewCount(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", post.ID).UpdateColumn("view_count", 7).Error; err != nil {
		t.Fatalf("set view_count: %v", err)
	}
	for _, content := range []string{"<p>d1</p>", "<p>d2</p>"} {
		if svcerr := saveDraft(author, post.ID, content, ""); svcerr != nil {
			t.Fatalf("save draft: %v", svcerr)
		}
	}
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{Title: "new"}}); svcerr != nil {
		t.Fatalf("update title: %v", svcerr)
	}
	if got := reloadPost(t, post.ID); got.ViewCount != 7 {
		t.Fatalf("update changed view_count: got %d, want 7", got.ViewCount)
	}
}
