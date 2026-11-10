package service

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 前台读取的文章有短时缓存，登录用户与访客共用：直接改库（如计数）时仍看到缓存；经文章接口修改后立即看到新内容，
// 同时前端的 posts 缓存标签换了版本号
func TestPublicPostCache(t *testing.T) {
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
	if cached, _ := svc.GetPostSlugOrId(author, key); cached.Title != first.Title || cached.IsLiked {
		t.Fatalf("logged-in user should share the cached post, got %q liked=%v", cached.Title, cached.IsLiked)
	}
	listReq := &dto.ListPostReq{PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt, Desc: true}}
	list, _, svcerr := svc.ListPosts(guest, listReq)
	if svcerr != nil || len(list) == 0 {
		t.Fatalf("guest list: %v %d", svcerr, len(list))
	}

	before, err := repo.CacheTagVersions()
	if err != nil {
		t.Fatal(err)
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
	after, err := repo.CacheTagVersions()
	if err != nil {
		t.Fatal(err)
	}
	if after[repo.CacheTagPosts] == "" || after[repo.CacheTagPosts] == before[repo.CacheTagPosts] {
		t.Fatalf("posts cache tag should change on update: %q -> %q", before[repo.CacheTagPosts], after[repo.CacheTagPosts])
	}
}

// 文章计数：公开文章返回最新值（不走缓存），私密文章与不存在的文章 404
func TestGetPublicPostStats(t *testing.T) {
	_, _, _, post, _ := setupEditTest(t)
	svc := NewPostService()
	db := repo.GetDB().Model(&model.Post{}).Where("id = ?", post.ID)
	if err := db.UpdateColumns(map[string]any{"is_private": false, "view_count": 7, "like_count": 3, "comment_count": 2}).Error; err != nil {
		t.Fatal(err)
	}
	stats, svcerr := svc.GetPublicPostStats(post.ID)
	if svcerr != nil || stats.ViewCount != 7 || stats.LikeCount != 3 || stats.CommentCount != 2 {
		t.Fatalf("stats: %+v %v", stats, svcerr)
	}
	if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", post.ID).UpdateColumn("is_private", true).Error; err != nil {
		t.Fatal(err)
	}
	if _, svcerr := svc.GetPublicPostStats(post.ID); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("private post stats should be 404, got %v", svcerr)
	}
	if _, svcerr := svc.GetPublicPostStats(post.ID + 1000); svcerr == nil || svcerr.Code != http.StatusNotFound {
		t.Fatalf("missing post stats should be 404, got %v", svcerr)
	}
}
