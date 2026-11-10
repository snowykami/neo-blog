package service

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"gorm.io/gorm"
)

var raceCallbackSeq atomic.Int64

// raceAfterLoad 只触发一次（每个用例使用新的数据库，回调不会残留到其他用例）：在下一次读取 table 的查询之后（UpdatePost / UpdatePage 读到快照、还没写回之前）执行一次 write，模拟期间他人的写入
func raceAfterLoad(t *testing.T, table string, write func(db *gorm.DB)) {
	t.Helper()
	var fired atomic.Bool
	name := fmt.Sprintf("test:race_after_load_%s_%d", table, raceCallbackSeq.Add(1))
	err := repo.GetDB().Callback().Query().After("gorm:query").Register(name, func(db *gorm.DB) {
		if db.Statement.Table == table && fired.CompareAndSwap(false, true) {
			write(repo.GetDB())
		}
	})
	if err != nil {
		t.Fatalf("register race callback: %v", err)
	}
}

// editorSavesPost 模拟编辑页自动保存：写入草稿并把版本号加一，同时有人点赞、浏览、置顶
func editorSavesPost(postID uint, draft string, pinnedAt time.Time) func(db *gorm.DB) {
	return func(db *gorm.DB) {
		db.Model(&model.Post{}).Where("id = ?", postID).UpdateColumns(map[string]any{
			"draft_content": draft,
			"draft_version": gorm.Expr("draft_version + 1"),
			"like_count":    gorm.Expr("like_count + 1"),
			"view_count":    gorm.Expr("view_count + 1"),
			"comment_count": gorm.Expr("comment_count + 1"),
			"heat":          gorm.Expr("heat + 1"),
			"pinned_at":     pinnedAt,
		})
	}
}

func assertPostKeptRace(t *testing.T, got *model.Post, base uint64, draft string) {
	t.Helper()
	if got.DraftContent == nil || *got.DraftContent != draft || got.DraftVersion != base+1 {
		t.Fatalf("concurrent draft lost: draft=%v version=%d, want %q v%d", got.DraftContent, got.DraftVersion, draft, base+1)
	}
	if got.Content != "<p>v1</p>" {
		t.Fatalf("published content changed: %q", got.Content)
	}
	if got.LikeCount != 1 || got.ViewCount != 1 || got.CommentCount != 1 || got.Heat != 1 || got.PinnedAt == nil {
		t.Fatalf("concurrent counters / pin lost: %+v", got)
	}
}

// 只改元信息（标题）时基于的是旧快照：期间编辑页保存的草稿与版本号、计数都不能被写回旧值
// 编辑页随后按新版本号保存不会一直 draft_conflict
func TestUpdatePostMetaKeepsConcurrentDraft(t *testing.T) {
	author, _, _, post, label := setupEditTest(t)
	base := post.DraftVersion
	draft := "<p>editor B</p>"
	raceAfterLoad(t, "posts", editorSavesPost(post.ID, draft, time.Now()))

	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{Title: "new title"}}); svcerr != nil {
		t.Fatalf("update title: %v", svcerr)
	}
	got := reloadPost(t, post.ID)
	if got.Title != "new title" {
		t.Fatalf("title not saved: %q", got.Title)
	}
	assertPostKeptRace(t, got, base, draft)
	if !got.IsPrivate || len(got.Labels) != 1 || got.Labels[0].ID != label.ID {
		t.Fatalf("untouched fields changed: %+v", got)
	}

	next := base + 1
	c := "<p>editor C</p>"
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{DraftContent: &c}, BaseDraftVersion: &next}); svcerr != nil {
		t.Fatalf("editor save on latest version: %v", svcerr)
	}
	if got := reloadPost(t, post.ID); got.DraftVersion != base+2 || *got.DraftContent != c {
		t.Fatalf("editor save not applied: %+v", got)
	}
}

// 取消发布 / 后台列表切换私密：只写 is_private，不写回旧的草稿、计数与置顶
func TestTogglePostPrivacyKeepsConcurrentWrites(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	base := post.DraftVersion
	draft := "<p>editor B</p>"
	for _, private := range []bool{false, true} {
		repo.GetDB().Model(&model.Post{}).Where("id = ?", post.ID).UpdateColumns(map[string]any{
			"draft_content": nil, "draft_version": base, "like_count": 0, "view_count": 0, "comment_count": 0, "heat": 0, "pinned_at": nil,
		})
		raceAfterLoad(t, "posts", editorSavesPost(post.ID, draft, time.Now()))
		if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, IsPrivate: &private}); svcerr != nil {
			t.Fatalf("toggle private=%v: %v", private, svcerr)
		}
		got := reloadPost(t, post.ID)
		if got.IsPrivate != private {
			t.Fatalf("is_private = %v, want %v", got.IsPrivate, private)
		}
		assertPostKeptRace(t, got, base, draft)
	}
}

// 写入正文时只写正文相关的列：读取之后他人改的元信息不被旧快照覆盖
func TestUpdatePostContentKeepsConcurrentMeta(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	base := post.DraftVersion
	raceAfterLoad(t, "posts", func(db *gorm.DB) {
		db.Model(&model.Post{}).Where("id = ?", post.ID).UpdateColumns(map[string]any{"title": "renamed", "description": "desc"})
	})
	draft := "<p>draft</p>"
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{DraftContent: &draft}, BaseDraftVersion: &base}); svcerr != nil {
		t.Fatalf("save draft: %v", svcerr)
	}
	got := reloadPost(t, post.ID)
	if got.Title != "renamed" || got.Description != "desc" || *got.DraftContent != draft || got.DraftVersion != base+1 {
		t.Fatalf("content save clobbered meta: %+v", got)
	}
	// 发布时正文哈希随正文一起写入
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{Content: draft, DraftContent: &draft}}); svcerr != nil {
		t.Fatalf("publish: %v", svcerr)
	}
	if got := reloadPost(t, post.ID); got.Content != draft || got.ContentHash != model.HashContent(draft) {
		t.Fatalf("content hash not updated: %+v", got)
	}
}

// 页面同理：只改元信息不写回期间保存的草稿、版本号与 HTML 版本
func TestUpdatePageMetaKeepsConcurrentDraft(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	pageID, svcerr := NewPageService().CreatePage(author, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "关于", Slug: "about", Content: "<p>hi</p>"}})
	if svcerr != nil {
		t.Fatalf("create page: %v", svcerr)
	}
	page, _ := repo.Page.GetPageByID(pageID)
	base := page.DraftVersion
	draft := "<p>editor B</p>"
	raceAfterLoad(t, "pages", func(db *gorm.DB) {
		db.Model(&model.Page{}).Where("id = ?", pageID).UpdateColumns(map[string]any{
			"draft_content": draft, "draft_version": gorm.Expr("draft_version + 1"), "html_version_id": 7,
		})
	})
	private := true
	if _, svcerr := NewPageService().UpdatePage(author, &dto.CreateOrUpdatePageReq{ID: pageID, PageBaseDto: dto.PageBaseDto{Title: "关于我"}, IsPrivate: &private}); svcerr != nil {
		t.Fatalf("update page: %v", svcerr)
	}
	got, _ := repo.Page.GetPageByID(pageID)
	if got.Title != "关于我" || !got.IsPrivate || got.Slug != "about" {
		t.Fatalf("meta not saved: %+v", got)
	}
	if got.DraftContent == nil || *got.DraftContent != draft || got.DraftVersion != base+1 || got.HTMLVersionID != 7 || got.Content != "<p>hi</p>" {
		t.Fatalf("concurrent page writes lost: %+v", got)
	}

	next := base + 1
	c := "<p>editor C</p>"
	if _, svcerr := NewPageService().UpdatePage(author, &dto.CreateOrUpdatePageReq{ID: pageID, PageBaseDto: dto.PageBaseDto{DraftContent: &c}, BaseDraftVersion: &next}); svcerr != nil {
		t.Fatalf("editor save on latest version: %v", svcerr)
	}
	if got, _ := repo.Page.GetPageByID(pageID); got.DraftVersion != base+2 || *got.DraftContent != c || got.Title != "关于我" {
		t.Fatalf("editor save not applied: %+v", got)
	}
}
