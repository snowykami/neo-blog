package service

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"testing"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestListUserLikesVisibility(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	otherID, _ := ctxutils.GetCurrentUserID(other)

	slug := "liked-post"
	publicPost := createPublicPost(t, author, &slug)
	laterPrivate := createPublicPost(t, author, nil)
	laterDeleted := createPublicPost(t, author, nil)

	mustComment := func(ctx context.Context, postID, replyID uint, private bool) uint {
		t.Helper()
		id, svcerr := createComment(ctx, postID, replyID, private)
		if svcerr != nil {
			t.Fatalf("create comment: %v", svcerr)
		}
		return id
	}
	publicComment := mustComment(author, publicPost, 0, false)
	// other 参与了这棵评论树，因此能看到并点赞作者的私密回复
	otherRoot := mustComment(other, publicPost, 0, false)
	privateReply := mustComment(author, publicPost, otherRoot, true)
	onLaterPrivate := mustComment(author, laterPrivate, 0, false)

	mustLike := func(targetType string, targetID uint) {
		t.Helper()
		if _, svcerr := NewLikeService().ToggleLike(other, targetID, targetType, nil); svcerr != nil {
			t.Fatalf("like %s %d: %v", targetType, targetID, svcerr)
		}
	}
	mustLike(constant.TargetTypePost, publicPost)
	mustLike(constant.TargetTypePost, laterPrivate)
	mustLike(constant.TargetTypePost, laterDeleted)
	mustLike(constant.TargetTypeComment, publicComment)
	mustLike(constant.TargetTypeComment, privateReply)
	mustLike(constant.TargetTypeComment, onLaterPrivate)

	// 文章事后改为私密 / 被软删除
	if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", laterPrivate).Update("is_private", true).Error; err != nil {
		t.Fatalf("make post private: %v", err)
	}
	if err := repo.GetDB().Delete(&model.Post{}, laterDeleted).Error; err != nil {
		t.Fatalf("soft delete post: %v", err)
	}

	list := func(ctx context.Context) ([]dto.UserLikeDto, int, bool) {
		t.Helper()
		likes, total, svcerr := NewLikeService().ListUserLikes(ctx, &dto.ListUserLikesReq{
			PaginationParams: dto.PaginationParams{Page: 1, Size: 50},
			UserID:           otherID,
		})
		if svcerr != nil {
			if svcerr.Code != http.StatusForbidden {
				t.Fatalf("list user likes: %v", svcerr)
			}
			return nil, 0, false
		}
		return likes, int(total), true
	}
	key := func(targetType string, id uint) string { return fmt.Sprintf("%s:%d", targetType, id) }
	keys := func(likes []dto.UserLikeDto) []string {
		result := make([]string, 0, len(likes))
		for _, like := range likes {
			if like.Target.Title == "" || like.Author.ID == 0 {
				t.Fatalf("like %d missing target or author: %+v", like.ID, like)
			}
			result = append(result, key(like.TargetType, like.TargetID))
		}
		slices.Sort(result)
		return result
	}
	sorted := func(items ...string) []string {
		slices.Sort(items)
		return items
	}

	// 默认不公开：访客与其他用户无权查看
	if _, _, ok := list(context.Background()); ok {
		t.Error("anonymous should be forbidden")
	}
	if _, _, ok := list(author); ok {
		t.Error("another user should be forbidden")
	}

	// 本人：已删除和事后变私密的目标都被过滤，参与过的私密评论树仍可见
	likes, total, ok := list(other)
	if !ok {
		t.Fatal("self should be allowed")
	}
	want := sorted(key(constant.TargetTypePost, publicPost), key(constant.TargetTypeComment, publicComment), key(constant.TargetTypeComment, privateReply))
	if got := keys(likes); total != len(likes) || !slices.Equal(got, want) {
		t.Errorf("self: want %v, got %v (total %d)", want, got, total)
	}
	for _, like := range likes {
		if like.TargetType == constant.TargetTypeComment && (like.Content == "" || like.Target.ID != publicPost) {
			t.Errorf("comment like %d should carry content and its post: %+v", like.TargetID, like)
		}
	}

	// 管理员：可见私密目标，已删除的目标仍被过滤
	likes, _, ok = list(admin)
	if !ok {
		t.Fatal("admin should be allowed")
	}
	want = sorted(append(want, key(constant.TargetTypePost, laterPrivate), key(constant.TargetTypeComment, onLaterPrivate))...)
	if got := keys(likes); !slices.Equal(got, want) {
		t.Errorf("admin: want %v, got %v", want, got)
	}

	// 开启「公开我的喜欢」后，其他人只能看到公开内容上的点赞
	if err := repo.GetDB().Model(&model.User{}).Where("id = ?", otherID).Update("show_likes", true).Error; err != nil {
		t.Fatalf("enable show likes: %v", err)
	}
	publicWant := sorted(key(constant.TargetTypePost, publicPost), key(constant.TargetTypeComment, publicComment))
	for name, ctx := range map[string]context.Context{"anonymous": context.Background(), "another user": author} {
		likes, _, ok := list(ctx)
		if !ok {
			t.Fatalf("%s should be allowed when likes are public", name)
		}
		if got := keys(likes); !slices.Equal(got, publicWant) {
			t.Errorf("%s: want %v, got %v", name, publicWant, got)
		}
	}
}
