package service

import (
	"context"
	"slices"
	"testing"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func listUserCommentIDs(t *testing.T, ctx context.Context, userID uint) []uint {
	t.Helper()
	comments, total, svcerr := NewCommentService().ListUserComments(ctx, &dto.ListUserCommentsReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: 50, OrderBy: constant.OrderByCreatedAt},
		UserID:           userID,
	})
	if svcerr != nil {
		t.Fatalf("list user comments: %v", svcerr)
	}
	if int(total) != len(comments) {
		t.Fatalf("total %d != len %d", total, len(comments))
	}
	ids := make([]uint, 0, len(comments))
	for _, c := range comments {
		if c.Target.Title == "" {
			t.Fatalf("comment %d missing target title", c.ID)
		}
		ids = append(ids, c.ID)
	}
	slices.Sort(ids)
	return ids
}

func TestListUserCommentsVisibility(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	anonymous := context.Background()
	otherID, _ := ctxutils.GetCurrentUserID(other)
	authorID, _ := ctxutils.GetCurrentUserID(author)

	slug := "public-post"
	publicPost := createPublicPost(t, author, &slug)
	laterPrivate := createPublicPost(t, author, nil)
	laterDeleted := createPublicPost(t, author, nil)
	page := &model.Page{UserID: authorID, PageBase: model.PageBase{Title: "about", Slug: "about"}}
	if err := repo.GetDB().Create(page).Error; err != nil {
		t.Fatalf("create page: %v", err)
	}

	mustComment := func(ctx context.Context, targetType string, targetID uint, private bool) uint {
		t.Helper()
		id, svcerr := NewCommentService().CreateComment(ctx, &dto.CreateCommentReq{
			TargetID: targetID, TargetType: targetType, Content: "c", IsPrivate: private,
		})
		if svcerr != nil {
			t.Fatalf("create comment: %v", svcerr)
		}
		return id
	}
	publicComment := mustComment(other, constant.TargetTypePost, publicPost, false)
	privateComment := mustComment(other, constant.TargetTypePost, publicPost, true)
	pageComment := mustComment(other, constant.TargetTypePage, page.ID, false)
	onPrivateTarget := mustComment(other, constant.TargetTypePost, laterPrivate, false)
	_ = mustComment(other, constant.TargetTypePost, laterDeleted, false)
	// 作者自己的评论不应出现在 other 的列表里
	_ = mustComment(author, constant.TargetTypePost, publicPost, false)

	// 文章事后改为私密 / 被软删除（不经过删除评论的流程）
	if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", laterPrivate).Update("is_private", true).Error; err != nil {
		t.Fatalf("make post private: %v", err)
	}
	if err := repo.GetDB().Delete(&model.Post{}, laterDeleted).Error; err != nil {
		t.Fatalf("soft delete post: %v", err)
	}

	sorted := func(ids ...uint) []uint {
		slices.Sort(ids)
		return ids
	}
	cases := []struct {
		name string
		ctx  context.Context
		want []uint
	}{
		// 访客与其他用户（即使是目标作者）只能看到公开目标下的公开评论
		{"anonymous", anonymous, sorted(publicComment, pageComment)},
		{"another user", author, sorted(publicComment, pageComment)},
		// 本人可见自己的私密评论，但看不到他人私密目标下的评论
		{"self", other, sorted(publicComment, privateComment, pageComment)},
		// 管理员可见全部，已删除目标下的评论除外
		{"admin", admin, sorted(publicComment, privateComment, pageComment, onPrivateTarget)},
	}
	for _, tc := range cases {
		if got := listUserCommentIDs(t, tc.ctx, otherID); !slices.Equal(got, tc.want) {
			t.Errorf("%s: want %v, got %v", tc.name, tc.want, got)
		}
	}
}
