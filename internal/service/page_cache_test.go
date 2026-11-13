package service

import (
	"context"
	"slices"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func TestPageServiceGuestCacheAndCrossInstanceInvalidation(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	capture := &publishCaptureStore{Store: sharedstate.Current()}
	sharedstate.UseStore(capture)
	t.Cleanup(sharedstate.UseMemory)

	pageSvc := NewPageService()
	anon := context.Background()
	showInNav := true
	isPrivate := false

	pageID, svcerr := pageSvc.CreatePage(author, &dto.CreateOrUpdatePageReq{
		PageBaseDto: dto.PageBaseDto{
			Title:   "About V1",
			Slug:    "about-cache-test",
			Content: "<p>v1</p>",
			Type:    "html",
		},
		IsPrivate: &isPrivate,
		ShowInNav: &showInNav,
	})
	if svcerr != nil {
		t.Fatalf("create page: %v", svcerr)
	}

	// 1. 首次读取详情与列表并写入 PageGuestCache
	detail, svcerr := pageSvc.GetPageSlugOrID(anon, "about-cache-test")
	if svcerr != nil || detail.Title != "About V1" {
		t.Fatalf("first GetPageSlugOrID = %+v, err=%v", detail, svcerr)
	}
	listReq := &dto.ListPageReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt, Desc: true},
		OnlyNav:          true,
	}
	pages, total, svcerr := pageSvc.ListPages(anon, listReq)
	if svcerr != nil || total != 1 || len(pages) != 1 || pages[0].Title != "About V1" {
		t.Fatalf("first ListPages = %+v total=%d err=%v", pages, total, svcerr)
	}

	// 2. 绕过 service 直接改底层表，验证访客读取命中缓存而非每次打库
	if err := repo.GetDB().Model(&model.Page{}).Where("id = ?", pageID).UpdateColumn("title", "Direct DB Mutation").Error; err != nil {
		t.Fatalf("direct db update: %v", err)
	}
	if cached, svcerr := pageSvc.GetPageSlugOrID(anon, "about-cache-test"); svcerr != nil || cached.Title != "About V1" {
		t.Fatalf("expected cache hit Title='About V1', got %+v err=%v", cached, svcerr)
	}

	// 3. 通过 PageService.UpdatePage 更新公开字段：立即失效本机缓存并发送 cache_evict 跨实例通知
	capture.mu.Lock()
	capture.published = nil
	capture.mu.Unlock()

	if _, svcerr := pageSvc.UpdatePage(author, &dto.CreateOrUpdatePageReq{
		ID: pageID,
		PageBaseDto: dto.PageBaseDto{
			Title: "About V2",
		},
	}); svcerr != nil {
		t.Fatalf("UpdatePage: %v", svcerr)
	}

	if updated, svcerr := pageSvc.GetPageSlugOrID(anon, "about-cache-test"); svcerr != nil || updated.Title != "About V2" {
		t.Fatalf("after UpdatePage GetPageSlugOrID = %+v err=%v, want About V2", updated, svcerr)
	}
	if updatedList, _, svcerr := pageSvc.ListPages(anon, listReq); svcerr != nil || len(updatedList) != 1 || updatedList[0].Title != "About V2" {
		t.Fatalf("after UpdatePage ListPages = %+v err=%v, want About V2", updatedList, svcerr)
	}

	capture.mu.Lock()
	evictMsgs := slices.Clone(capture.published["cache_evict"])
	capture.mu.Unlock()
	if !slices.Contains(evictMsgs, "page:guest") {
		t.Fatalf("expected cache_evict 'page:guest' broadcast on UpdatePage, got %v", evictMsgs)
	}

	// 4. 切换为私密状态：前台详情应立即返回 404，导航列表应立即为空
	priv := true
	if _, svcerr := pageSvc.UpdatePage(author, &dto.CreateOrUpdatePageReq{
		ID:        pageID,
		IsPrivate: &priv,
	}); svcerr != nil {
		t.Fatalf("toggle private: %v", svcerr)
	}
	if _, svcerr := pageSvc.GetPageSlugOrID(anon, "about-cache-test"); svcerr == nil || svcerr.Code != 404 {
		t.Fatalf("private page should immediately 404, got err=%v", svcerr)
	}
	if navPages, navTotal, svcerr := pageSvc.ListPages(anon, listReq); svcerr != nil || navTotal != 0 || len(navPages) != 0 {
		t.Fatalf("private page should disappear from nav list, got total=%d len=%d err=%v", navTotal, len(navPages), svcerr)
	}

	// 5. 切回公开并测试删除页面后缓存立即失效
	pub := false
	if _, svcerr := pageSvc.UpdatePage(author, &dto.CreateOrUpdatePageReq{
		ID:        pageID,
		IsPrivate: &pub,
	}); svcerr != nil {
		t.Fatalf("toggle public: %v", svcerr)
	}
	if d, svcerr := pageSvc.GetPageSlugOrID(anon, "about-cache-test"); svcerr != nil || d.Title != "About V2" {
		t.Fatalf("re-published page should be readable: %+v err=%v", d, svcerr)
	}
	if svcerr := pageSvc.DeletePage(author, pageID); svcerr != nil {
		t.Fatalf("DeletePage: %v", svcerr)
	}
	if _, svcerr := pageSvc.GetPageSlugOrID(anon, "about-cache-test"); svcerr == nil || svcerr.Code != 404 {
		t.Fatalf("deleted page should 404 immediately, got err=%v", svcerr)
	}
}
