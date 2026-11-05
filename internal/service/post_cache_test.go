package service

import (
	"context"
	"strconv"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 访客读取的文章有短时缓存：直接改库（如计数）时访客仍看到缓存，登录用户看到最新；经文章接口修改后访客立即看到新内容
func TestGuestPostCache(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	svc := NewPostService()
	guest := context.Background()
	slug := ""
	if post.Slug != nil {
		slug = *post.Slug
	}
	key := slug
	if key == "" {
		key = strconv.FormatUint(uint64(post.ID), 10)
	}

	if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", post.ID).UpdateColumn("is_private", false).Error; err != nil {
		t.Fatal(err)
	}
	first, svcerr := svc.GetPostSlugOrId(guest, key)
	if svcerr != nil {
		t.Fatalf("guest read: %v", svcerr)
	}
	if first.DraftContent != nil {
		t.Fatal("guest cache should not keep the draft")
	}
	if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", post.ID).UpdateColumn("title", "changed directly").Error; err != nil {
		t.Fatal(err)
	}
	if cached, _ := svc.GetPostSlugOrId(guest, key); cached.Title != first.Title {
		t.Fatalf("guest should read the cached post, got %q", cached.Title)
	}
	if fresh, _ := svc.GetPostSlugOrId(author, key); fresh.Title != "changed directly" {
		t.Fatalf("logged-in user should bypass the cache, got %q", fresh.Title)
	}
	listReq := &dto.ListPostReq{PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt, Desc: true}}
	list, _, svcerr := svc.ListPosts(guest, listReq)
	if svcerr != nil || len(list) == 0 {
		t.Fatalf("guest list: %v %d", svcerr, len(list))
	}

	title := "updated through the API"
	if _, svcerr := svc.UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{Title: title}}); svcerr != nil {
		t.Fatalf("update: %v", svcerr)
	}
	if updated, _ := svc.GetPostSlugOrId(guest, key); updated.Title != title {
		t.Fatalf("guest should see the update immediately, got %q", updated.Title)
	}
	list, _, _ = svc.ListPosts(guest, listReq)
	found := false
	for _, item := range list {
		if item.ID == post.ID && item.Title == title {
			found = true
		}
	}
	if !found {
		t.Fatal("guest list should be invalidated by the update")
	}
}
