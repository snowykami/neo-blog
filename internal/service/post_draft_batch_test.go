package service

import (
	"context"
	"strconv"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestPostDraftLifecycle(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	ps := NewPostService()
	guest := context.Background()

	// 1. 新建空正文文章：默认处于未首次发布草稿态（IsDraft = true）
	isPrivate := false
	slug := "new-unpublished-post"
	postID, svcerr := ps.CreatePost(author, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{
			Title:   "新建未发布文章",
			Slug:    &slug,
			Content: "",
			Type:    "html",
		},
		IsPrivate: &isPrivate,
	})
	if svcerr != nil {
		t.Fatalf("CreatePost failed: %v", svcerr)
	}

	raw := reloadPost(t, postID)
	if !raw.IsDraft {
		t.Fatalf("expected newly created empty post to have IsDraft=true, got false")
	}

	// 2. 访客与其他用户均不可通过公开详情/公开列表读取，但作者本人与编辑视图可读
	if _, svcerr := ps.GetPostSlugOrId(guest, strconv.FormatUint(uint64(postID), 10)); svcerr == nil || svcerr.Code != 404 {
		t.Fatalf("expected 404 for guest on unpublished draft post, got %v", svcerr)
	}
	if _, svcerr := ps.GetPostSlugOrId(other, "new-unpublished-post"); svcerr == nil || svcerr.Code != 404 {
		t.Fatalf("expected 404 for non-owner on unpublished draft post, got %v", svcerr)
	}
	pubPosts, total, svcerr := ps.ListPosts(guest, &dto.ListPostReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: "created_at", Desc: true},
	})
	if svcerr != nil {
		t.Fatalf("ListPosts failed: %v", svcerr)
	}
	for _, p := range pubPosts {
		if p.ID == postID {
			t.Fatalf("unpublished draft post %d leaked into public ListPosts (total=%d)", postID, total)
		}
	}
	editDto, svcerr := ps.GetPostForEdit(author, strconv.FormatUint(uint64(postID), 10))
	if svcerr != nil || !editDto.IsDraft {
		t.Fatalf("GetPostForEdit expected IsDraft=true, err=%v, dto=%+v", svcerr, editDto)
	}

	// 3. 自动保存草稿正文：更新 DraftContent / HasDraft，但仍保持 IsDraft = true，不提前公开
	draftBody := "<p>正在撰写中的草稿</p>"
	if _, svcerr := ps.UpdatePost(author, &dto.CreateOrUpdatePostReq{
		ID: postID,
		PostBaseDto: dto.PostBaseDto{
			DraftContent: &draftBody,
		},
	}); svcerr != nil {
		t.Fatalf("autosave draft failed: %v", svcerr)
	}
	raw = reloadPost(t, postID)
	if !raw.IsDraft || !raw.HasDraft {
		t.Fatalf("after autosave expected IsDraft=true && HasDraft=true, got IsDraft=%v HasDraft=%v", raw.IsDraft, raw.HasDraft)
	}
	if _, svcerr := ps.GetPostSlugOrId(guest, "new-unpublished-post"); svcerr == nil {
		t.Fatalf("autosaved draft post should still be hidden from guest")
	}

	// 4. 首次点击发布（同时提交 Content 与匹配的 DraftContent）：解除 IsDraft 并立即可公开访问
	publishedBody := "<p>正式发布的第一版内容</p>"
	if _, svcerr := ps.UpdatePost(author, &dto.CreateOrUpdatePostReq{
		ID: postID,
		PostBaseDto: dto.PostBaseDto{
			Content:      publishedBody,
			DraftContent: &publishedBody,
		},
	}); svcerr != nil {
		t.Fatalf("first publish failed: %v", svcerr)
	}
	raw = reloadPost(t, postID)
	if raw.IsDraft || raw.HasDraft {
		t.Fatalf("after publish expected IsDraft=false && HasDraft=false, got IsDraft=%v HasDraft=%v", raw.IsDraft, raw.HasDraft)
	}
	got, svcerr := ps.GetPostSlugOrId(guest, "new-unpublished-post")
	if svcerr != nil || got.IsDraft {
		t.Fatalf("published post should be visible to guest, err=%v, got=%+v", svcerr, got)
	}
}

func TestBatchPostAndCommentOperations(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	ps := NewPostService()
	cs := NewCommentService()

	pub := false
	p1, err1 := ps.CreatePost(author, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{Title: "P1", Content: "<p>1</p>"},
		IsPrivate:   &pub,
	})
	p2, err2 := ps.CreatePost(author, &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{Title: "P2", Content: "<p>2</p>"},
		IsPrivate:   &pub,
	})
	if err1 != nil || err2 != nil {
		t.Fatalf("create posts failed: %v, %v", err1, err2)
	}

	// 非作者无权批量修改可见性或删除（整批拒绝，不产生部分副作用）
	if _, svcerr := ps.BatchUpdateVisibility(other, []uint{p1, p2}, true); svcerr == nil || svcerr.Code != 403 {
		t.Fatalf("expected 403 for non-owner BatchUpdateVisibility, got %v", svcerr)
	}
	if reloadPost(t, p1).IsPrivate {
		t.Fatalf("p1 should remain public after rejected batch visibility")
	}

	// 作者本人批量设为私密
	updated, svcerr := ps.BatchUpdateVisibility(author, []uint{p1, p2, p1}, true)
	if svcerr != nil || updated != 2 {
		t.Fatalf("BatchUpdateVisibility expected updated=2, err=%v, updated=%d", svcerr, updated)
	}
	if !reloadPost(t, p1).IsPrivate || !reloadPost(t, p2).IsPrivate {
		t.Fatalf("expected both p1 and p2 to be private")
	}
	// 再恢复公开以便测试评论批量删除
	if _, svcerr := ps.BatchUpdateVisibility(author, []uint{p1, p2}, false); svcerr != nil {
		t.Fatalf("restore public failed: %v", svcerr)
	}

	// 在 p1 下创建两条评论（other 发表，文章作者 author 与管理员 admin 均可批量删除）
	c1, svcerr := cs.CreateComment(other, &dto.CreateCommentReq{
		TargetID:   p1,
		TargetType: constant.TargetTypePost,
		Content:    "comment 1",
	})
	if svcerr != nil {
		t.Fatalf("create comment 1: %v", svcerr)
	}
	c2, svcerr := cs.CreateComment(other, &dto.CreateCommentReq{
		TargetID:   p1,
		TargetType: constant.TargetTypePost,
		Content:    "comment 2",
	})
	if svcerr != nil {
		t.Fatalf("create comment 2: %v", svcerr)
	}

	// 文章作者可批量删除自己文章下的评论
	delComments, svcerr := cs.BatchDeleteComments(author, []uint{c1, c2})
	if svcerr != nil || delComments != 2 {
		t.Fatalf("BatchDeleteComments by post owner failed: err=%v, deleted=%d", svcerr, delComments)
	}
	if _, err := repo.Comment.GetComment(c1); err == nil {
		t.Fatalf("c1 should be deleted")
	}

	// 管理员可跨用户批量删除文章
	delPosts, svcerr := ps.BatchDeletePosts(admin, []uint{p1, p2})
	if svcerr != nil || delPosts != 2 {
		t.Fatalf("BatchDeletePosts by admin failed: err=%v, deleted=%d", svcerr, delPosts)
	}
	if _, err := repo.Post.GetPostByID(p1); err == nil {
		t.Fatalf("p1 should be deleted")
	}
}
