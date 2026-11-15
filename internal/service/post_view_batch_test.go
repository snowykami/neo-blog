package service

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/cache"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestPostViewBatchOverlayAndConcurrentFlush(t *testing.T) {
	author, admin, _, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	slugStr := strconv.FormatUint(uint64(postID), 10)
	postSvc := NewPostService()
	visitSvc := NewVisitService()
	anon := context.Background()

	// 将文章同时置顶，覆盖 ListPinnedPosts 增量叠加验证
	if _, svcerr := postSvc.SetPostPin(admin, &dto.SetPostPinReq{ID: postID, Pinned: true}); svcerr != nil {
		t.Fatalf("pin post: %v", svcerr)
	}

	// 预热详情、列表、置顶、引用卡片缓存（此时阅读量为 0）
	if d, svcerr := postSvc.GetPostSlugOrId(anon, slugStr); svcerr != nil || d.ViewCount != 0 {
		t.Fatalf("warm detail = %+v, err=%v", d, svcerr)
	}
	listReq := &dto.ListPostReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt, Desc: true},
		Query:            "public", // 非首页默认列表，包含已置顶文章
	}
	if _, _, svcerr := postSvc.ListPosts(anon, listReq); svcerr != nil {
		t.Fatalf("warm list: %v", svcerr)
	}
	if _, svcerr := postSvc.ListPinnedPosts(anon); svcerr != nil {
		t.Fatalf("warm pinned: %v", svcerr)
	}
	if _, svcerr := postSvc.ListPostCards(anon, []uint{postID}); svcerr != nil {
		t.Fatalf("warm cards: %v", svcerr)
	}
	if _, svcerr := postSvc.GetPostNeighbors(postID); svcerr != nil {
		t.Fatalf("warm neighbors: %v", svcerr)
	}
	if _, ok := cache.GetJSON[*dto.PostDto](repo.PostGuestCache, "detail:"+slugStr); !ok {
		t.Fatalf("expected detail:%s cached before flush", slugStr)
	}
	if _, ok := cache.GetJSON[*dto.PostNeighborsResp](repo.PostGuestCache, "neighbors:"+slugStr); !ok {
		t.Fatalf("expected neighbors:%s cached before flush", slugStr)
	}

	// 并发上报 6 个不同独立访客访问（不同 IP 与路径去重键：使用不同访客各自首次访问同一路径）
	const visitors = 6
	var wg sync.WaitGroup
	for i := range visitors {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			ip := fmt.Sprintf("198.51.100.%d", idx+10)
			_, svcerr := visitSvc.Report(anon, &dto.ReportVisitReq{
				Path:       fmt.Sprintf("/posts/%d", postID),
				TargetType: constant.TargetTypePost,
				TargetID:   postID,
			}, "", VisitClient{IP: ip, UserAgent: testChromeUA})
			if svcerr != nil {
				t.Errorf("report visitor %d: %v", idx, svcerr)
			}
		}(i)
	}
	wg.Wait()

	// 尚未刷库时：数据库原值仍为 0，没有承受每次访问的行锁写入
	if dbCount := reloadPost(t, postID).ViewCount; dbCount != 0 {
		t.Fatalf("raw db view_count before flush = %d, want 0", dbCount)
	}

	// 但所有公开/后台读取接口均已实时叠加增量返回 6（即便缓存尚在有效期内）
	if d, svcerr := postSvc.GetPostSlugOrId(anon, slugStr); svcerr != nil || d.ViewCount != visitors {
		t.Fatalf("cached detail live view_count = %v (err=%v), want %d", d, svcerr, visitors)
	}
	if stats, svcerr := postSvc.GetPublicPostStats(postID); svcerr != nil || stats.ViewCount != visitors {
		t.Fatalf("stats live view_count = %v (err=%v), want %d", stats, svcerr, visitors)
	}
	if items, _, svcerr := postSvc.ListPosts(anon, listReq); svcerr != nil {
		t.Fatalf("list posts: %v", svcerr)
	} else {
		var found bool
		for _, it := range items {
			if it.ID == postID {
				found = true
				if it.ViewCount != visitors {
					t.Fatalf("list post view_count = %d, want %d", it.ViewCount, visitors)
				}
			}
		}
		if !found {
			t.Fatalf("post %d not found in ListPosts", postID)
		}
	}
	if pinned, svcerr := postSvc.ListPinnedPosts(anon); svcerr != nil || len(pinned) == 0 || pinned[0].ViewCount != visitors {
		t.Fatalf("pinned view_count = %+v (err=%v), want %d", pinned, svcerr, visitors)
	}
	if cards, svcerr := postSvc.ListPostCards(anon, []uint{postID}); svcerr != nil || len(cards) != 1 || cards[0].ViewCount != visitors {
		t.Fatalf("cards view_count = %+v (err=%v), want %d", cards, svcerr, visitors)
	}
	if editDto, svcerr := postSvc.GetPostForEdit(author, slugStr); svcerr != nil || editDto.ViewCount != visitors {
		t.Fatalf("edit dto view_count = %+v (err=%v), want %d", editDto, svcerr, visitors)
	}

	// 并发多协程同时触发 FlushPostViewCounts（模拟多实例/定时任务与停机钩子竞争），通过原子 Take 保证精确落库一次
	var flushWG sync.WaitGroup
	for range 8 {
		flushWG.Add(1)
		go func() {
			defer flushWG.Done()
			FlushPostViewCounts()
		}()
	}
	flushWG.Wait()

	if dbCount := reloadPost(t, postID).ViewCount; dbCount != visitors {
		t.Fatalf("db view_count after concurrent flush = %d, want %d", dbCount, visitors)
	}
	if pending := PendingPostViewDelta(postID); pending != 0 {
		t.Fatalf("pending delta after flush = %d, want 0", pending)
	}
	// 刷库后不应清空 PostGuestCache，详情与上下篇等与阅读量无关的缓存条目保持温热
	if _, ok := cache.GetJSON[*dto.PostDto](repo.PostGuestCache, "detail:"+slugStr); !ok {
		t.Fatalf("expected detail:%s to stay warm across FlushPostViewCounts", slugStr)
	}
	if _, ok := cache.GetJSON[*dto.PostNeighborsResp](repo.PostGuestCache, "neighbors:"+slugStr); !ok {
		t.Fatalf("expected neighbors:%s to stay warm across FlushPostViewCounts", slugStr)
	}
	// 刷库后再次读取详情（仍命中缓存内旧快照 baseline=0，依赖 post:view_flushed 基线保持 visitors）
	if d, svcerr := postSvc.GetPostSlugOrId(anon, slugStr); svcerr != nil || d.ViewCount != visitors {
		t.Fatalf("detail view_count after flush = %+v (err=%v), want %d", d, svcerr, visitors)
	}
	// 缓存仍未失效时继续新增访问，应与已刷基线叠加得到 visitors+1
	if _, svcerr := visitSvc.Report(anon, &dto.ReportVisitReq{
		Path:       fmt.Sprintf("/posts/%d", postID),
		TargetType: constant.TargetTypePost,
		TargetID:   postID,
	}, "", VisitClient{IP: "198.51.100.200", UserAgent: testChromeUA}); svcerr != nil {
		t.Fatalf("post-flush report: %v", svcerr)
	}
	if d, svcerr := postSvc.GetPostSlugOrId(anon, slugStr); svcerr != nil || d.ViewCount != visitors+1 {
		t.Fatalf("detail view_count after flush + extra report = %+v (err=%v), want %d", d, svcerr, visitors+1)
	}
	if listItems, _, svcerr := postSvc.ListPosts(anon, listReq); svcerr != nil || len(listItems) == 0 || listItems[0].ViewCount != visitors+1 {
		t.Fatalf("list view_count after flush + extra report = %+v (err=%v), want %d", listItems, svcerr, visitors+1)
	}
	if cards, svcerr := postSvc.ListPostCards(anon, []uint{postID}); svcerr != nil || len(cards) != 1 || cards[0].ViewCount != visitors+1 {
		t.Fatalf("cards view_count after flush + extra report = %+v (err=%v), want %d", cards, svcerr, visitors+1)
	}
}

func TestPostViewFlushRollbackOnDBFailure(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	visitSvc := NewVisitService()
	anon := context.Background()

	if _, svcerr := visitSvc.Report(anon, &dto.ReportVisitReq{
		Path:       fmt.Sprintf("/posts/%d", postID),
		TargetType: constant.TargetTypePost,
		TargetID:   postID,
	}, "", VisitClient{IP: "203.0.113.77", UserAgent: testChromeUA}); svcerr != nil {
		t.Fatalf("report: %v", svcerr)
	}
	if got := PendingPostViewDelta(postID); got != 1 {
		t.Fatalf("pending before failed flush = %d, want 1", got)
	}

	// 临时重命名表制造刷库 SQL 报错，验证增量通过 IncrBy 回滚到 sharedstate 不丢失
	if err := repo.GetDB().Exec("ALTER TABLE posts RENAME TO posts_bak_view_test").Error; err != nil {
		t.Fatalf("rename posts: %v", err)
	}
	FlushPostViewCounts()
	if err := repo.GetDB().Exec("ALTER TABLE posts_bak_view_test RENAME TO posts").Error; err != nil {
		t.Fatalf("restore posts: %v", err)
	}

	if got := PendingPostViewDelta(postID); got != 1 {
		t.Fatalf("pending after failed flush rollback = %d, want 1", got)
	}

	// 恢复后再次刷库应成功落库
	FlushPostViewCounts()
	var post model.Post
	if err := repo.GetDB().First(&post, postID).Error; err != nil {
		t.Fatalf("query post: %v", err)
	}
	if post.ViewCount != 1 || PendingPostViewDelta(postID) != 0 {
		t.Fatalf("after recovery flush db=%d pending=%d, want 1 and 0", post.ViewCount, PendingPostViewDelta(postID))
	}

	// 验证 StartViewCountFlusher 在 ctx 取消时也会把剩余增量排空写库
	flusherCtx, cancel := context.WithCancel(context.Background())
	StartViewCountFlusher(flusherCtx)
	if _, svcerr := visitSvc.Report(anon, &dto.ReportVisitReq{
		Path:       fmt.Sprintf("/posts/%d", postID),
		TargetType: constant.TargetTypePost,
		TargetID:   postID,
	}, "", VisitClient{IP: "203.0.113.78", UserAgent: testChromeUA, DoNotTrack: true}); svcerr != nil {
		t.Fatalf("report dnt: %v", svcerr)
	}
	cancel()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if reloadPost(t, postID).ViewCount == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := reloadPost(t, postID).ViewCount; got != 2 {
		t.Fatalf("flusher stop drain db view_count = %d, want 2", got)
	}
}

func TestPublicSlugOrIDLookupAndOmitDraftAndNoContent(t *testing.T) {
	author, _, _, basePost, _ := setupEditTest(t)
	authorID := basePost.UserID
	postDraft := "secret-post-draft"
	slugNum := "999999"
	post := &model.Post{
		UserID:   authorID,
		HasDraft: true,
		PostBase: model.PostBase{
			Title:        "numeric slug post",
			Slug:         &slugNum,
			Content:      "public-post-body",
			DraftContent: &postDraft,
			IsPrivate:    false,
			IsDraft:      false,
		},
	}
	if err := repo.Post.CreatePost(post); err != nil {
		t.Fatalf("create post: %v", err)
	}

	// 数字优先按 ID 命中；不存在对应主键时回退按纯数字 slug 查询；前台读取不带 draft_content
	byID, err := repo.Post.GetPublicPostBySlugOrID(strconv.FormatUint(uint64(post.ID), 10))
	if err != nil {
		t.Fatalf("GetPublicPostBySlugOrID by id: %v", err)
	}
	if byID.ID != post.ID || byID.DraftContent != nil {
		t.Fatalf("unexpected public post by id: id=%d draft=%v", byID.ID, byID.DraftContent)
	}
	byNumericSlug, err := repo.Post.GetPublicPostBySlugOrID(slugNum)
	if err != nil {
		t.Fatalf("GetPublicPostBySlugOrID by numeric slug: %v", err)
	}
	if byNumericSlug.ID != post.ID || byNumericSlug.DraftContent != nil {
		t.Fatalf("unexpected public post by numeric slug: id=%d draft=%v", byNumericSlug.ID, byNumericSlug.DraftContent)
	}
	// 编辑接口仍能拿到 draft_content
	editDto, svcerr := NewPostService().GetPostForEdit(author, slugNum)
	if svcerr != nil || editDto.DraftContent == nil || *editDto.DraftContent != postDraft {
		t.Fatalf("GetPostForEdit draft = %+v (err=%v), want %q", editDto, svcerr, postDraft)
	}

	// 页面同样支持 digits-first + 数字 slug 回退 + 前台省略 draft_content + no_content=true 省略正文
	pageDraft := "secret-page-draft"
	pageSlug := "888888"
	pg := &model.Page{
		UserID:   authorID,
		HasDraft: true,
		PageBase: model.PageBase{
			Title:        "numeric slug page",
			Slug:         pageSlug,
			Content:      "public-page-body",
			DraftContent: &pageDraft,
			ShowInNav:    true,
			IsPrivate:    false,
		},
	}
	if err := repo.Page.CreatePage(pg); err != nil {
		t.Fatalf("create page: %v", err)
	}
	pubPage, err := repo.Page.GetPublicPageBySlugOrID(pageSlug)
	if err != nil || pubPage.ID != pg.ID || pubPage.DraftContent != nil {
		t.Fatalf("GetPublicPageBySlugOrID = %+v, err=%v", pubPage, err)
	}
	editPage, err := repo.Page.GetPageBySlugOrID(strconv.FormatUint(uint64(pg.ID), 10))
	if err != nil || editPage.DraftContent == nil || *editPage.DraftContent != pageDraft {
		t.Fatalf("GetPageBySlugOrID = %+v, err=%v", editPage, err)
	}

	pageSvc := NewPageService()
	pages, total, svcerr := pageSvc.ListPages(context.Background(), &dto.ListPageReq{
		OnlyNav:          true,
		NoContent:        true,
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10},
	})
	if svcerr != nil || total == 0 || len(pages) == 0 {
		t.Fatalf("ListPages NoContent = %v total=%d err=%v", pages, total, svcerr)
	}
	for _, item := range pages {
		if item.ID == pg.ID && (item.Content != "" || item.DraftContent != nil) {
			t.Fatalf("expected no_content page to omit content and draft_content, got content=%q draft=%v", item.Content, item.DraftContent)
		}
	}
}
