package service

import (
	"net/http"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func revisionsOf(t *testing.T, targetType string, id uint) []model.ContentRevision {
	t.Helper()
	var revisions []model.ContentRevision
	if err := repo.GetDB().Where("target_type = ? AND target_id = ?", targetType, id).Order("id ASC").Find(&revisions).Error; err != nil {
		t.Fatalf("list revisions: %v", err)
	}
	return revisions
}

// 让最新版本“变旧”，以便测试自动保存检查点的时间间隔
func ageLatestRevision(t *testing.T, targetType string, id uint) {
	t.Helper()
	latest, _ := repo.Revision.Latest(targetType, id)
	if err := repo.GetDB().Model(&model.ContentRevision{}).Where("id = ?", latest.ID).Update("created_at", time.Now().Add(-revisionAutosaveInterval-time.Minute)).Error; err != nil {
		t.Fatalf("age revision: %v", err)
	}
}

func TestRevisionLifecycle(t *testing.T) {
	author, _, other, post, label := setupEditTest(t)
	posts, revisions := NewPostService(), NewRevisionService()

	// 打开编辑器：记录编辑起点；内容没变时再次打开复用同一版本
	session, svcerr := NewEditSessionService().Acquire(author, constant.TargetTypePost, post.ID, "test")
	if svcerr != nil || session.BaseRevisionID == 0 {
		t.Fatalf("acquire: %v %+v", svcerr, session)
	}
	again, _ := NewEditSessionService().Acquire(author, constant.TargetTypePost, post.ID, "test")
	if again.BaseRevisionID != session.BaseRevisionID {
		t.Fatalf("unchanged content should reuse revision: %d vs %d", again.BaseRevisionID, session.BaseRevisionID)
	}
	sid, base := again.SessionID, again.BaseRevisionID

	save := func(req *dto.CreateOrUpdatePostReq) {
		t.Helper()
		req.ID, req.EditSessionID = post.ID, sid
		if _, svcerr := posts.UpdatePost(author, req); svcerr != nil {
			t.Fatalf("update: %v", svcerr)
		}
	}
	draft := func(html string) *string { return &html }

	// 自动保存：距上一个版本不足间隔时不记录，超过间隔后记录一个检查点
	save(&dto.CreateOrUpdatePostReq{PostBaseDto: dto.PostBaseDto{Title: "改过的标题", DraftContent: draft("<p>改了几个字</p>"), LabelIds: []uint{}}})
	if n := len(revisionsOf(t, constant.TargetTypePost, post.ID)); n != 1 {
		t.Fatalf("autosave within interval should be skipped, got %d revisions", n)
	}
	ageLatestRevision(t, constant.TargetTypePost, post.ID)
	save(&dto.CreateOrUpdatePostReq{PostBaseDto: dto.PostBaseDto{DraftContent: draft("<p>又改了几个字</p>")}})
	list := revisionsOf(t, constant.TargetTypePost, post.ID)
	if len(list) != 2 || list[1].Kind != RevisionKindAutosave || list[1].Content != "<p>又改了几个字</p>" || list[1].Title != "改过的标题" {
		t.Fatalf("expected autosave checkpoint, got %+v", list)
	}

	// 放弃本次修改：恢复到编辑起点，正文草稿与元信息（标题、标签、置顶、私密）一起恢复
	if svcerr := revisions.Restore(author, constant.TargetTypePost, post.ID, base, sid); svcerr != nil {
		t.Fatalf("restore: %v", svcerr)
	}
	restored := reloadPost(t, post.ID)
	if restored.Title != "t" || restored.DraftContent == nil || *restored.DraftContent != "<p>v1</p>" || len(restored.Labels) != 1 || restored.Labels[0].ID != label.ID || restored.Top != 5 || !restored.IsPrivate {
		t.Fatalf("restore to session base failed: %+v", restored)
	}
	// 恢复前的状态一定有对应版本（新建备份，或与之相同的最新版本），恢复本身可以撤回
	list = revisionsOf(t, constant.TargetTypePost, post.ID)
	backup := list[len(list)-1]
	if backup.Content != "<p>又改了几个字</p>" || backup.Title != "改过的标题" {
		t.Fatalf("expected a revision of the state before restore, got %+v", backup)
	}
	if svcerr := revisions.Restore(author, constant.TargetTypePost, post.ID, backup.ID, sid); svcerr != nil {
		t.Fatalf("undo restore: %v", svcerr)
	}
	if got := reloadPost(t, post.ID); got.Title != "改过的标题" || *got.DraftContent != "<p>又改了几个字</p>" || len(got.Labels) != 0 {
		t.Fatalf("undo restore failed: %+v", got)
	}

	// 发布：必定记录发布版本
	save(&dto.CreateOrUpdatePostReq{PostBaseDto: dto.PostBaseDto{Content: "<p>发布的正文</p>", DraftContent: draft("<p>发布的正文</p>")}})
	list = revisionsOf(t, constant.TargetTypePost, post.ID)
	if last := list[len(list)-1]; last.Kind != RevisionKindPublish || last.Content != "<p>发布的正文</p>" {
		t.Fatalf("expected publish revision, got %+v", last)
	}

	// 放弃未发布的修改：草稿回到已发布的正文，元信息不变
	save(&dto.CreateOrUpdatePostReq{PostBaseDto: dto.PostBaseDto{Title: "发布后改标题", DraftContent: draft("<p>发布后又改</p>")}})
	if svcerr := revisions.DiscardDraft(author, constant.TargetTypePost, post.ID, sid); svcerr != nil {
		t.Fatalf("discard draft: %v", svcerr)
	}
	if got := reloadPost(t, post.ID); *got.DraftContent != "<p>发布的正文</p>" || got.Title != "发布后改标题" {
		t.Fatalf("discard draft failed: %+v", got)
	}

	// 列表与详情
	resp, svcerr := revisions.List(author, constant.TargetTypePost, post.ID, dto.PaginationParams{Page: 1, Size: 50})
	if svcerr != nil || resp.Total == 0 || resp.Revisions[0].ID != revisionsOf(t, constant.TargetTypePost, post.ID)[int(resp.Total)-1].ID {
		t.Fatalf("list should be newest first: %v %+v", svcerr, resp)
	}
	detail, svcerr := revisions.Get(author, constant.TargetTypePost, post.ID, base)
	if svcerr != nil || detail.Content != "<p>v1</p>" || detail.Meta.Title != "t" || detail.Meta.Top != 5 || detail.Kind != RevisionKindSession {
		t.Fatalf("detail: %v %+v", svcerr, detail)
	}

	// 权限：其他用户不能查看或恢复；被顶掉的编辑会话不能恢复
	_, listErr := revisions.List(other, constant.TargetTypePost, post.ID, dto.PaginationParams{})
	expectCode(t, listErr, http.StatusForbidden, "other list")
	expectCode(t, revisions.Restore(other, constant.TargetTypePost, post.ID, base, sid), http.StatusForbidden, "other restore")
	expectCode(t, revisions.Restore(author, constant.TargetTypePost, post.ID, base, "stale-session"), http.StatusConflict, "stale session")
	expectCode(t, revisions.DiscardDraft(author, constant.TargetTypePost, post.ID, "stale-session"), http.StatusConflict, "stale discard")
	expectCode(t, revisions.Restore(author, constant.TargetTypePost, post.ID, 999999, sid), http.StatusNotFound, "missing revision")

	// 删除文章时一并删除版本
	if svcerr := posts.DeletePost(author, post.ID); svcerr != nil {
		t.Fatalf("delete: %v", svcerr)
	}
	if n := len(revisionsOf(t, constant.TargetTypePost, post.ID)); n != 0 {
		t.Fatalf("revisions should be deleted with post, got %d", n)
	}
}

// 非发布版本每篇最多保留 revisionKeep 个，发布版本永久保留
func TestRevisionPrune(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	s := NewRevisionService()
	session, _ := NewEditSessionService().Acquire(author, constant.TargetTypePost, post.ID, "test")
	html := "<p>published</p>"
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{Content: html, DraftContent: &html}, EditSessionID: session.SessionID}); svcerr != nil {
		t.Fatalf("publish: %v", svcerr)
	}
	for i := range revisionKeep + 5 {
		draft := "<p>" + time.Now().Format(time.RFC3339Nano) + string(rune('a'+i%26)) + "</p>"
		if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", post.ID).UpdateColumn("draft_content", draft).Error; err != nil {
			t.Fatalf("set draft: %v", err)
		}
		if svcerr := s.backup(author, constant.TargetTypePost, post.ID, session.SessionID); svcerr != nil {
			t.Fatalf("backup: %v", svcerr)
		}
	}
	publish, others := 0, 0
	for _, r := range revisionsOf(t, constant.TargetTypePost, post.ID) {
		if r.Kind == RevisionKindPublish {
			publish++
		} else {
			others++
		}
	}
	if publish != 1 || others != revisionKeep {
		t.Fatalf("expected 1 publish and %d others, got %d and %d", revisionKeep, publish, others)
	}
}

// 页面：恢复 slug 与导航设置
func TestRevisionPage(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	pageID, svcerr := NewPageService().CreatePage(author, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "关于", Slug: "about", Content: "<p>hi</p>"}})
	if svcerr != nil {
		t.Fatalf("create page: %v", svcerr)
	}
	session, _ := NewEditSessionService().Acquire(author, constant.TargetTypePage, pageID, "test")
	draft, show, order := "<p>改了</p>", true, 3
	if _, svcerr := NewPageService().UpdatePage(author, &dto.CreateOrUpdatePageReq{ID: pageID, PageBaseDto: dto.PageBaseDto{Title: "关于我", Slug: "about-me", DraftContent: &draft}, ShowInNav: &show, NavOrder: &order, EditSessionID: session.SessionID}); svcerr != nil {
		t.Fatalf("update page: %v", svcerr)
	}
	if svcerr := NewRevisionService().Restore(author, constant.TargetTypePage, pageID, session.BaseRevisionID, session.SessionID); svcerr != nil {
		t.Fatalf("restore page: %v", svcerr)
	}
	page, _ := repo.Page.GetPageByID(pageID)
	if page.Title != "关于" || page.Slug != "about" || page.ShowInNav || page.NavOrder != 0 || page.DraftContent == nil || *page.DraftContent != "<p>hi</p>" {
		t.Fatalf("restore page failed: %+v", page)
	}
}
