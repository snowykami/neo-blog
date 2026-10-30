package service

import (
	"context"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
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

// backupRevisions 直接改写草稿（不经过保存接口）再记录备份版本，用于快速生成大量版本
func backupRevisions(t *testing.T, ctx context.Context, postID uint, sessionID string, n int) {
	t.Helper()
	for i := range n {
		draft := "<p>" + time.Now().Format(time.RFC3339Nano) + strconv.Itoa(i) + "</p>"
		if err := repo.GetDB().Model(&model.Post{}).Where("id = ?", postID).UpdateColumn("draft_content", draft).Error; err != nil {
			t.Fatalf("set draft: %v", err)
		}
		if svcerr := NewRevisionService().backup(ctx, constant.TargetTypePost, postID, sessionID); svcerr != nil {
			t.Fatalf("backup: %v", svcerr)
		}
	}
}

func publishPost(t *testing.T, ctx context.Context, postID uint, sessionID, html string) uint {
	t.Helper()
	if _, svcerr := NewPostService().UpdatePost(ctx, &dto.CreateOrUpdatePostReq{ID: postID, PostBaseDto: dto.PostBaseDto{Content: html, DraftContent: &html}, EditSessionID: sessionID}); svcerr != nil {
		t.Fatalf("publish: %v", svcerr)
	}
	id, _ := repo.Revision.LatestID(constant.TargetTypePost, postID, RevisionKindPublish)
	return id
}

func revisionIDs(t *testing.T, targetType string, id uint) []uint {
	t.Helper()
	var ids []uint
	for _, r := range revisionsOf(t, targetType, id) {
		ids = append(ids, r.ID)
	}
	return ids
}

// 保留上限：读取全局配置，缺失或类型不符时取默认值，超出范围时取边界值
func TestRevisionMaxKeepConfig(t *testing.T) {
	setupEditTest(t)
	if got := tools.GetRevisionMaxKeep(); got != tools.RevisionMaxKeepDefault {
		t.Fatalf("default = %d", got)
	}
	for value, want := range map[any]int{3: tools.RevisionMaxKeepMin, 9999: tools.RevisionMaxKeepMax, 120: 120, "abc": tools.RevisionMaxKeepDefault} {
		if err := repo.KV.SetKV("revision_max_keep", value); err != nil {
			t.Fatal(err)
		}
		if got := tools.GetRevisionMaxKeep(); got != want {
			t.Fatalf("revision_max_keep %v: got %d, want %d", value, got, want)
		}
	}
}

// 版本总数（含发布版本）按上限保留；当前发布的版本、最新版本与当前编辑会话的编辑起点始终保留
func TestRevisionPrune(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	if err := repo.KV.SetKV("revision_max_keep", tools.RevisionMaxKeepMin); err != nil {
		t.Fatal(err)
	}
	keep := tools.RevisionMaxKeepMin
	session, _ := NewEditSessionService().Acquire(author, constant.TargetTypePost, post.ID, "test")
	base := session.BaseRevisionID
	published := publishPost(t, author, post.ID, session.SessionID, "<p>published</p>")

	// 编辑起点与发布版本都已超出最新的 keep 个，仍然保留
	backupRevisions(t, author, post.ID, session.SessionID, keep*2)
	ids := revisionIDs(t, constant.TargetTypePost, post.ID)
	if len(ids) != keep+2 || ids[0] != base || ids[1] != published {
		t.Fatalf("expected base, published and newest %d, got %v (base %d, published %d)", keep, ids, base, published)
	}

	// 频繁发布同样受上限约束：旧的发布版本不再永久保留
	for i := range keep * 2 {
		published = publishPost(t, author, post.ID, session.SessionID, "<p>published "+strconv.Itoa(i)+"</p>")
	}
	ids = revisionIDs(t, constant.TargetTypePost, post.ID)
	if len(ids) != keep+1 || ids[0] != base || ids[len(ids)-1] != published {
		t.Fatalf("expected base and newest %d publishes, got %v", keep, ids)
	}

	// 编辑会话被顶掉后，旧的编辑起点不再受保护，下一次写入版本时被清理
	if _, svcerr := NewEditSessionService().Acquire(author, constant.TargetTypePost, post.ID, "test"); svcerr != nil {
		t.Fatalf("re-acquire: %v", svcerr)
	}
	backupRevisions(t, author, post.ID, "", 1)
	ids = revisionIDs(t, constant.TargetTypePost, post.ID)
	if len(ids) != keep || slices.Contains(ids, base) {
		t.Fatalf("old base should be pruned, got %v", ids)
	}
}

// 存量数据与调低上限：定期清理所有超出上限的目标，受保护的版本始终保留
func TestRevisionPruneAll(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	userID, _ := ctxutils.GetCurrentUserID(author)
	pageID, svcerr := NewPageService().CreatePage(author, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "关于", Slug: "about", Content: "<p>hi</p>"}})
	if svcerr != nil {
		t.Fatalf("create page: %v", svcerr)
	}
	// 文章的编辑起点是最旧的版本；之后直接写入旧规则下累积的大量发布版本（不经过即时清理）
	session, _ := NewEditSessionService().Acquire(author, constant.TargetTypePost, post.ID, "test")
	insert := func(targetType string, targetID uint, kind string, n int) {
		for i := range n {
			if err := repo.Revision.Create(&model.ContentRevision{TargetType: targetType, TargetID: targetID, Kind: kind, UserID: userID, Content: "<p>" + strconv.Itoa(i) + "</p>"}); err != nil {
				t.Fatalf("insert revision: %v", err)
			}
		}
	}
	insert(constant.TargetTypePost, post.ID, RevisionKindPublish, 60)
	insert(constant.TargetTypePage, pageID, RevisionKindAutosave, 30)
	newestPublish, _ := repo.Revision.LatestID(constant.TargetTypePost, post.ID, RevisionKindPublish)

	s := NewRevisionService()
	deleted, err := s.PruneAll()
	postIDs := revisionIDs(t, constant.TargetTypePost, post.ID)
	if err != nil || deleted != 10 || len(postIDs) != tools.RevisionMaxKeepDefault+1 || postIDs[0] != session.BaseRevisionID || postIDs[len(postIDs)-1] != newestPublish {
		t.Fatalf("prune all: deleted %d, err %v, post revisions %d", deleted, err, len(postIDs))
	}
	if n := len(revisionIDs(t, constant.TargetTypePage, pageID)); n != 30 {
		t.Fatalf("page under the limit should be untouched, got %d", n)
	}

	// 调低上限后，未再编辑的内容也会被清理到新的上限
	if err := repo.KV.SetKV("revision_max_keep", 20); err != nil {
		t.Fatal(err)
	}
	deleted, err = s.PruneAll()
	postIDs = revisionIDs(t, constant.TargetTypePost, post.ID)
	if err != nil || deleted != 40 || len(postIDs) != 21 || postIDs[0] != session.BaseRevisionID {
		t.Fatalf("prune after lowering limit: deleted %d, err %v, post revisions %v", deleted, err, postIDs)
	}
	if n := len(revisionIDs(t, constant.TargetTypePage, pageID)); n != 20 {
		t.Fatalf("page should be pruned to 20, got %d", n)
	}
	// 已在上限以内时不再删除
	if deleted, err = s.PruneAll(); err != nil || deleted != 0 {
		t.Fatalf("second prune: deleted %d, err %v", deleted, err)
	}
}

// 删除版本：单个与批量，受保护的版本不能删除，需有编辑权限并持有当前编辑会话
func TestRevisionDelete(t *testing.T) {
	author, admin, other, post, _ := setupEditTest(t)
	s := NewRevisionService()
	session, _ := NewEditSessionService().Acquire(author, constant.TargetTypePost, post.ID, "test")
	sid, base := session.SessionID, session.BaseRevisionID
	published := publishPost(t, author, post.ID, sid, "<p>published</p>")
	backupRevisions(t, author, post.ID, sid, 5)
	ids := revisionIDs(t, constant.TargetTypePost, post.ID)
	latest, olds := ids[len(ids)-1], ids[2:len(ids)-1]

	// 列表标出受保护的版本与保留上限
	resp, svcerr := s.List(author, constant.TargetTypePost, post.ID, dto.PaginationParams{Page: 1, Size: 50})
	if svcerr != nil || resp.MaxKeep != tools.RevisionMaxKeepDefault {
		t.Fatalf("list: %v %+v", svcerr, resp)
	}
	wantProtected := map[uint]string{base: RevisionProtectedBase, published: RevisionProtectedPublished, latest: RevisionProtectedLatest}
	for _, r := range resp.Revisions {
		if r.Protected != wantProtected[r.ID] {
			t.Fatalf("revision %d protected = %q, want %q", r.ID, r.Protected, wantProtected[r.ID])
		}
	}

	// 受保护的版本不能删除；批量中含有受保护的版本时整批拒绝
	for id := range wantProtected {
		svcerr := s.Delete(author, constant.TargetTypePost, post.ID, id, sid)
		if svcerr == nil || svcerr.Code != http.StatusBadRequest || svcerr.Message != "revision_protected" {
			t.Fatalf("delete protected %d: %v", id, svcerr)
		}
	}
	_, svcerr = s.BatchDelete(author, constant.TargetTypePost, post.ID, []uint{olds[0], published}, sid)
	expectCode(t, svcerr, http.StatusBadRequest, "batch with protected")
	if !slices.Contains(revisionIDs(t, constant.TargetTypePost, post.ID), olds[0]) {
		t.Fatal("rejected batch must not delete anything")
	}

	// 权限：其他编辑者不能删除；被顶掉的编辑会话不能删除
	expectCode(t, s.Delete(other, constant.TargetTypePost, post.ID, olds[0], sid), http.StatusForbidden, "other delete")
	_, svcerr = s.BatchDelete(other, constant.TargetTypePost, post.ID, []uint{olds[0]}, sid)
	expectCode(t, svcerr, http.StatusForbidden, "other batch delete")
	expectCode(t, s.Delete(author, constant.TargetTypePost, post.ID, olds[0], "stale-session"), http.StatusConflict, "stale delete")

	// 参数校验：空列表、ID 为 0、超出单次上限
	tooMany := make([]uint, revisionBatchDeleteMax+1)
	for i := range tooMany {
		tooMany[i] = uint(i + 1)
	}
	for name, batch := range map[string][]uint{"empty": nil, "zero": {olds[0], 0}, "too many": tooMany} {
		_, svcerr := s.BatchDelete(author, constant.TargetTypePost, post.ID, batch, sid)
		expectCode(t, svcerr, http.StatusBadRequest, name)
	}

	// 单个删除；已不存在的版本返回 404
	if svcerr := s.Delete(author, constant.TargetTypePost, post.ID, olds[0], sid); svcerr != nil {
		t.Fatalf("delete: %v", svcerr)
	}
	expectCode(t, s.Delete(author, constant.TargetTypePost, post.ID, olds[0], sid), http.StatusNotFound, "delete again")

	// 批量删除：其他文章的版本 ID 被忽略，已删除的版本不计入
	otherPostID, svcerr := NewPostService().CreatePost(author, &dto.CreateOrUpdatePostReq{PostBaseDto: dto.PostBaseDto{Title: "另一篇", Content: "<p>x</p>"}})
	if svcerr != nil {
		t.Fatalf("create post: %v", svcerr)
	}
	otherSession, _ := NewEditSessionService().Acquire(author, constant.TargetTypePost, otherPostID, "test")
	result, svcerr := s.BatchDelete(author, constant.TargetTypePost, post.ID, []uint{olds[0], olds[1], olds[2], otherSession.BaseRevisionID}, sid)
	if svcerr != nil || result.Deleted != 2 {
		t.Fatalf("batch delete: %v %+v", svcerr, result)
	}
	if len(revisionIDs(t, constant.TargetTypePost, otherPostID)) != 1 {
		t.Fatal("revision of another post must not be deleted")
	}

	// 管理员：接管编辑会话后可以删除他人文章的版本；原会话的编辑起点不再受保护
	adminSession, svcerr := NewEditSessionService().Acquire(admin, constant.TargetTypePost, post.ID, "test")
	if svcerr != nil {
		t.Fatalf("admin acquire: %v", svcerr)
	}
	result, svcerr = s.BatchDelete(admin, constant.TargetTypePost, post.ID, []uint{olds[3], base}, adminSession.SessionID)
	if svcerr != nil || result.Deleted != 2 {
		t.Fatalf("admin batch delete: %v %+v", svcerr, result)
	}
	if ids := revisionIDs(t, constant.TargetTypePost, post.ID); len(ids) != 2 || ids[0] != published || ids[1] != latest {
		t.Fatalf("expected only published and latest left, got %v", ids)
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

// 页面版式：默认阅读版式，可改为宽屏，不认识的值按阅读处理；只保存草稿不改动版式；恢复版本时一并恢复
func TestPageLayout(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	s := NewPageService()
	pageID, svcerr := s.CreatePage(author, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "关于", Slug: "about", Content: "<p>hi</p>"}})
	if svcerr != nil {
		t.Fatalf("create page: %v", svcerr)
	}
	layoutOf := func() string {
		page, _ := repo.Page.GetPageByID(pageID)
		return page.ToDto().Layout
	}
	if got := layoutOf(); got != model.PageLayoutReading {
		t.Fatalf("default layout = %q", got)
	}

	session, _ := NewEditSessionService().Acquire(author, constant.TargetTypePage, pageID, "test")
	update := func(layout *string) {
		t.Helper()
		draft := "<p>改了</p>"
		if _, svcerr := s.UpdatePage(author, &dto.CreateOrUpdatePageReq{ID: pageID, PageBaseDto: dto.PageBaseDto{Title: "关于", Slug: "about", DraftContent: &draft}, Layout: layout, EditSessionID: session.SessionID}); svcerr != nil {
			t.Fatalf("update page: %v", svcerr)
		}
	}
	wide, unknown := model.PageLayoutWide, "fullscreen"
	update(&wide)
	if got := layoutOf(); got != model.PageLayoutWide {
		t.Fatalf("layout after update = %q", got)
	}
	// 只保存草稿（未传版式）不改动
	update(nil)
	if got := layoutOf(); got != model.PageLayoutWide {
		t.Fatalf("draft save should keep layout, got %q", got)
	}
	update(&unknown)
	if got := layoutOf(); got != model.PageLayoutReading {
		t.Fatalf("unknown layout should fall back to reading, got %q", got)
	}

	// 恢复到打开编辑时的版本：版式随之恢复
	update(&wide)
	if svcerr := NewRevisionService().Restore(author, constant.TargetTypePage, pageID, session.BaseRevisionID, session.SessionID); svcerr != nil {
		t.Fatalf("restore page: %v", svcerr)
	}
	if got := layoutOf(); got != model.PageLayoutReading {
		t.Fatalf("restore should bring back layout, got %q", got)
	}
}

func TestPageKindLinkAndFullscreen(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	s := NewPageService()
	ptr := func(v string) *string { return &v }
	create := func(slug string, kind, link *string) (uint, *errs.ServiceError) {
		return s.CreatePage(author, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: slug, Slug: slug}, Kind: kind, LinkURL: link})
	}

	// 合法的站内路径与站外地址
	for slug, link := range map[string]string{"music": "/music", "github": "https://github.com/snowykami"} {
		id, svcerr := create(slug, ptr(model.PageKindLink), ptr(link))
		if svcerr != nil {
			t.Fatalf("create link %s: %v", link, svcerr)
		}
		page, _ := repo.Page.GetPageByID(id)
		if got := page.ToDto(); got.Kind != model.PageKindLink || got.LinkURL != link {
			t.Fatalf("link page = %+v", got.PageBaseDto)
		}
	}
	// 非法地址：协议相对、javascript:、空白、空
	for i, link := range []string{"//evil.com", "javascript:alert(1)", "/a b", "", "ftp://x.com/a"} {
		if _, svcerr := create("bad"+strconv.Itoa(i), ptr(model.PageKindLink), ptr(link)); svcerr == nil || svcerr.Code != http.StatusBadRequest {
			t.Fatalf("link %q should be rejected, got %v", link, svcerr)
		}
	}
	// 链接页面不填 slug 时自动生成，可以创建多个；正文页面仍然必须填写
	for range 2 {
		id, svcerr := s.CreatePage(author, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "外链"}, Kind: ptr(model.PageKindLink), LinkURL: ptr("/music")})
		if svcerr != nil {
			t.Fatalf("create link page without slug: %v", svcerr)
		}
		if page, _ := repo.Page.GetPageByID(id); !strings.HasPrefix(page.Slug, linkPageSlugPrefix) {
			t.Fatalf("generated slug = %q", page.Slug)
		}
	}
	if _, svcerr := s.CreatePage(author, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "正文"}}); svcerr == nil {
		t.Fatal("content page without slug should be rejected")
	}

	// 未指定类型时为正文页面，忽略链接地址
	id, svcerr := create("plain", nil, ptr("/ignored"))
	if svcerr != nil {
		t.Fatalf("create content page: %v", svcerr)
	}
	page, _ := repo.Page.GetPageByID(id)
	if got := page.ToDto(); got.Kind != model.PageKindContent || got.LinkURL != "" || got.Fullscreen {
		t.Fatalf("content page = %+v", got.PageBaseDto)
	}

	// 全屏设置：更新后保留，恢复版本时随之恢复
	session, _ := NewEditSessionService().Acquire(author, constant.TargetTypePage, id, "test")
	update := func(req dto.CreateOrUpdatePageReq) *errs.ServiceError {
		draft := "<p>改了</p>"
		req.ID, req.PageBaseDto.Title, req.PageBaseDto.Slug, req.PageBaseDto.DraftContent, req.EditSessionID = id, "plain", "plain", &draft, session.SessionID
		_, svcerr := s.UpdatePage(author, &req)
		return svcerr
	}
	on := true
	if svcerr := update(dto.CreateOrUpdatePageReq{Fullscreen: &on}); svcerr != nil {
		t.Fatalf("update fullscreen: %v", svcerr)
	}
	if page, _ = repo.Page.GetPageByID(id); !page.Fullscreen {
		t.Fatal("fullscreen should be saved")
	}
	// 改成链接页面但地址非法：拒绝
	if svcerr := update(dto.CreateOrUpdatePageReq{Kind: ptr(model.PageKindLink), LinkURL: ptr("javascript:x")}); svcerr == nil {
		t.Fatal("invalid link on update should be rejected")
	}
	if svcerr := NewRevisionService().Restore(author, constant.TargetTypePage, id, session.BaseRevisionID, session.SessionID); svcerr != nil {
		t.Fatalf("restore: %v", svcerr)
	}
	if page, _ = repo.Page.GetPageByID(id); page.Fullscreen {
		t.Fatal("restore should bring back fullscreen = false")
	}
}
