package service

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
)

func createPublicPost(t *testing.T, ctx context.Context, slug *string) uint {
	t.Helper()
	isPrivate := false
	id, svcerr := NewPostService().CreatePost(ctx, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{Title: "public", Content: "<p>hi</p>", Slug: slug},
		IsPrivate:   &isPrivate,
	})
	if svcerr != nil {
		t.Fatalf("create public post: %v", svcerr)
	}
	return id
}

func createComment(ctx context.Context, postID, replyID uint, private bool) (uint, *errs.ServiceError) {
	return NewCommentService().CreateComment(ctx, &dto.CreateCommentReq{
		TargetID: postID, TargetType: constant.TargetTypePost, Content: "c", ReplyID: replyID, IsPrivate: private,
	})
}

func expectCode(t *testing.T, svcerr *errs.ServiceError, code int, msg string) {
	t.Helper()
	if svcerr == nil || svcerr.Code != code {
		t.Fatalf("%s: want %d, got %v", msg, code, svcerr)
	}
}

func listComments(t *testing.T, ctx context.Context, postID uint) ([]dto.CommentDto, *errs.ServiceError) {
	t.Helper()
	depth := -1
	return NewCommentService().GetCommentList(ctx, &dto.GetCommentListReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: 50, OrderBy: constant.OrderByCreatedAt},
		TargetID:         postID, TargetType: constant.TargetTypePost, Depth: &depth,
	})
}

func TestCommentVisibility(t *testing.T) {
	author, admin, other, privatePost, _ := setupEditTest(t)
	anonymous := context.Background()

	// 私密文章：他人既不能评论也不能读评论，作者可以
	_, svcerr := createComment(other, privatePost.ID, 0, false)
	expectCode(t, svcerr, http.StatusNotFound, "comment on private post")
	if _, svcerr := createComment(author, privatePost.ID, 0, false); svcerr != nil {
		t.Fatalf("author comment on own private post: %v", svcerr)
	}
	_, svcerr = listComments(t, anonymous, privatePost.ID)
	expectCode(t, svcerr, http.StatusNotFound, "list private post comments")

	// 公开文章下的私密评论：非参与者不能通过回复加入评论树
	publicPost := createPublicPost(t, author, nil)
	privateComment, svcerr := createComment(admin, publicPost, 0, true)
	if svcerr != nil {
		t.Fatalf("create private comment: %v", svcerr)
	}
	_, svcerr = createComment(other, publicPost, privateComment, false)
	expectCode(t, svcerr, http.StatusNotFound, "reply to invisible private comment")
	comments, svcerr := listComments(t, other, publicPost)
	if svcerr != nil || len(comments) != 0 {
		t.Fatalf("other should see no private comments, got %d (%v)", len(comments), svcerr)
	}
	// 文章作者可以看到并回复
	if comments, _ := listComments(t, author, publicPost); len(comments) != 1 {
		t.Fatalf("post author should see private comment, got %d", len(comments))
	}

	// 回复必须属于同一目标
	otherPost := createPublicPost(t, author, nil)
	publicComment, _ := createComment(other, publicPost, 0, false)
	_, svcerr = createComment(other, otherPost, publicComment, false)
	expectCode(t, svcerr, http.StatusBadRequest, "reply across targets")

	// 删除带回复的评论后计数正确
	reply, svcerr := createComment(author, publicPost, publicComment, false)
	if svcerr != nil {
		t.Fatalf("reply: %v", svcerr)
	}
	if _, svcerr := NewLikeService().ToggleLike(other, reply, constant.TargetTypeComment); svcerr != nil {
		t.Fatalf("like reply: %v", svcerr)
	}
	if svcerr := NewCommentService().DeleteComment(other, publicComment); svcerr != nil {
		t.Fatalf("delete comment: %v", svcerr)
	}
	if post := reloadPost(t, publicPost); post.CommentCount != 1 {
		t.Fatalf("comment count after delete = %d, want 1", post.CommentCount)
	}
	var likes int64
	repo.GetDB().Model(&model.Like{}).Where("target_type = ? AND target_id = ?", constant.TargetTypeComment, reply).Count(&likes)
	if likes != 0 {
		t.Fatalf("likes on deleted reply should be removed, got %d", likes)
	}

	// 后台评论搜索 JOIN users 后排序不应报列名歧义
	if _, _, svcerr := NewCommentService().ListCommentsAdmin(admin, &dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt, Desc: true}, "admin"); svcerr != nil {
		t.Fatalf("admin comment search: %v", svcerr)
	}
}

func TestToggleLikeCount(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	like := func() bool {
		liked, svcerr := NewLikeService().ToggleLike(other, postID, constant.TargetTypePost)
		if svcerr != nil {
			t.Fatalf("toggle like: %v", svcerr)
		}
		return liked
	}
	if !like() || reloadPost(t, postID).LikeCount != 1 {
		t.Fatalf("first like should set count to 1")
	}
	if like() || reloadPost(t, postID).LikeCount != 0 {
		t.Fatalf("second toggle should unlike and set count to 0")
	}
	if !like() || reloadPost(t, postID).LikeCount != 1 {
		t.Fatalf("liking again after unlike should work (no soft-deleted unique conflict)")
	}
	_, svcerr := NewLikeService().ToggleLike(other, 99999, constant.TargetTypePost)
	expectCode(t, svcerr, http.StatusNotFound, "like missing post")
}

func TestPostSlugAndCategory(t *testing.T) {
	author, _, _, _, label := setupEditTest(t)
	empty, numeric, taken := "", "123", "hello"
	first := createPublicPost(t, author, &empty)
	createPublicPost(t, author, &empty) // 多篇无 slug 的文章不应触发唯一约束
	if post := reloadPost(t, first); post.Slug != nil {
		t.Fatalf("empty slug should be stored as NULL, got %q", *post.Slug)
	}
	_, svcerr := NewPostService().CreatePost(author, &dto.CreateOrUpdatePostReq{PostBaseDto: dto.PostBaseDto{Title: "n", Slug: &numeric}})
	expectCode(t, svcerr, http.StatusBadRequest, "numeric slug")

	withSlug := createPublicPost(t, author, &taken)
	_, svcerr = NewPostService().CreatePost(author, &dto.CreateOrUpdatePostReq{PostBaseDto: dto.PostBaseDto{Title: "dup", Slug: &taken}})
	expectCode(t, svcerr, http.StatusConflict, "duplicate slug")
	if svcerr := NewPostService().DeletePost(author, withSlug); svcerr != nil {
		t.Fatalf("delete post: %v", svcerr)
	}
	createPublicPost(t, author, &taken) // 删除后 slug 可复用

	// 分类：0 表示取消分类
	category := &model.Category{Name: "c", Slug: "c"}
	repo.GetDB().Create(category)
	update := func(categoryID uint) {
		if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: first, PostBaseDto: dto.PostBaseDto{CategoryID: &categoryID}}); svcerr != nil {
			t.Fatalf("update category: %v", svcerr)
		}
	}
	update(category.ID)
	if post := reloadPost(t, first); post.CategoryID == nil || *post.CategoryID != category.ID {
		t.Fatalf("category should be set")
	}
	update(0)
	if post := reloadPost(t, first); post.CategoryID != nil {
		t.Fatalf("category should be cleared, got %d", *post.CategoryID)
	}

	// 标签计数只统计公开文章；删除后 slug 可复用
	labelDto, svcerr := NewLabelService().GetLabelByID(label.ID)
	if svcerr != nil || labelDto.PostCount != 0 {
		t.Fatalf("label post count should exclude private posts, got %+v (%v)", labelDto, svcerr)
	}
	if svcerr := NewLabelService().DeleteLabel(label.ID); svcerr != nil {
		t.Fatalf("delete label: %v", svcerr)
	}
	if _, svcerr := NewLabelService().CreateLabel(&dto.CreateLabelReq{LabelBase: dto.LabelBase{Name: "go", Slug: "go"}}); svcerr != nil {
		t.Fatalf("recreate label with same slug: %v", svcerr)
	}
}

func TestPageListOrderByIsWhitelisted(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	req := &dto.ListPageReq{PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: "(CASE WHEN 1=1 THEN title ELSE id END)"}}
	if _, _, svcerr := NewPageService().ListPages(author, req); svcerr != nil {
		t.Fatalf("malicious order_by should fall back instead of failing: %v", svcerr)
	}
	if req.OrderBy != constant.OrderByCreatedAt {
		t.Fatalf("order_by should fall back to created_at, got %q", req.OrderBy)
	}
}

func TestUserEmailVisibility(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	authorID, _ := author.Value("user_id").(uint)
	get := func(ctx context.Context) string {
		resp, svcerr := NewUserService().GetUser(ctx, &dto.GetUserReq{UserID: authorID})
		if svcerr != nil {
			t.Fatalf("get user: %v", svcerr)
		}
		return resp.User.Email
	}
	if get(context.Background()) != "" || get(other) != "" {
		t.Fatalf("email must not be visible to others")
	}
	if get(author) == "" || get(admin) == "" {
		t.Fatalf("email should be visible to self and admin")
	}
}

func TestChangePasswordRevokesOtherSessions(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	authorID, _ := author.Value("user_id").(uint)
	hashed, err := utils.Password.HashPassword("old-password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	repo.GetDB().Model(&model.User{}).Where("id = ?", authorID).Update("password", hashed)
	for _, sid := range []string{"current", "stale"} {
		repo.GetDB().Create(&model.Session{UserID: authorID, SessionID: sid})
	}
	ctx := context.WithValue(author, "session_id", "current")
	if _, svcerr := NewUserService().UpdatePassword(ctx, &dto.UpdatePasswordReq{OldPassword: "old-password", NewPassword: "new-password"}); svcerr != nil {
		t.Fatalf("update password: %v", svcerr)
	}
	for sid, want := range map[string]bool{"current": true, "stale": false} {
		if valid, _ := repo.Session.IsSessionValidForUser(sid, authorID); valid != want {
			t.Fatalf("session %s valid = %v, want %v", sid, valid, want)
		}
	}
}

func TestListPostsLightweightColumns(t *testing.T) {
	author, _, other, _, label := setupEditTest(t)
	long := strings.Repeat("长", 300)
	isPrivate := false
	id, svcerr := NewPostService().CreatePost(author, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{Title: "searchable", Content: long, LabelIds: []uint{label.ID}},
		IsPrivate:   &isPrivate,
	})
	if svcerr != nil {
		t.Fatalf("create post: %v", svcerr)
	}
	draft := "<p>secret</p>"
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: id, PostBaseDto: dto.PostBaseDto{DraftContent: &draft}}); svcerr != nil {
		t.Fatalf("save draft: %v", svcerr)
	}
	// 标签筛选 + 搜索 + 按热度排序，同时 JOIN post_labels，列名需带表名
	posts, total, svcerr := NewPostService().ListPosts(other, &dto.ListPostReq{
		Query: "searchable", Label: label.Slug,
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByHeat, Desc: true},
	})
	if svcerr != nil || total != 1 || len(posts) != 1 {
		t.Fatalf("list posts = %d/%d (%v)", len(posts), total, svcerr)
	}
	got := posts[0]
	if got.DraftContent != nil || len(got.Labels) != 1 || got.User.Username != "author" {
		t.Fatalf("unexpected list item: draft=%v labels=%d user=%q", got.DraftContent, len(got.Labels), got.User.Username)
	}
	if got.Content != strings.Repeat("长", 200)+"..." {
		t.Fatalf("summary should be first 200 runes with ellipsis, got %d runes", len([]rune(got.Content)))
	}
}

func TestKVCacheInvalidation(t *testing.T) {
	setupEditTest(t)
	if repo.KV.GetIntWithoutErr("posts_per_page", 10) != 10 {
		t.Fatalf("default should be returned when key missing")
	}
	if err := repo.KV.SetKV("posts_per_page", 20); err != nil {
		t.Fatalf("set kv: %v", err)
	}
	if got := repo.KV.GetIntWithoutErr("posts_per_page", 10); got != 20 {
		t.Fatalf("cached miss should be invalidated after set, got %d", got)
	}
	if err := repo.KV.DeleteKV("posts_per_page"); err != nil {
		t.Fatalf("delete kv: %v", err)
	}
	if got := repo.KV.GetIntWithoutErr("posts_per_page", 10); got != 10 {
		t.Fatalf("cache should be invalidated after delete, got %d", got)
	}
}
