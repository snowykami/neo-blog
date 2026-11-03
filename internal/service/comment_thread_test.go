package service

import (
	"context"
	"testing"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 主评论列表附带线程摘要；按 root_id 获取整个线程（不限层级）；私密回复只对参与者与目标作者可见
func TestCommentThreads(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	reply := func(ctx context.Context, replyID uint, private bool) uint {
		t.Helper()
		id, svcerr := NewCommentService().CreateComment(ctx, &dto.CreateCommentReq{TargetID: postID, TargetType: constant.TargetTypePost, Content: "c", ReplyID: replyID, IsPrivate: private})
		if svcerr != nil {
			t.Fatalf("create comment: %v", svcerr)
		}
		return id
	}
	root := reply(other, 0, false)
	first := reply(author, root, false)
	nested := reply(admin, first, false) // 第二层回复
	_ = reply(admin, root, true)         // 私密回复
	quiet := reply(other, 0, false)      // 没有回复的主评论

	list := func(ctx context.Context, req dto.GetCommentListReq) []dto.CommentDto {
		t.Helper()
		req.TargetID, req.TargetType = postID, constant.TargetTypePost
		req.PaginationParams = dto.PaginationParams{Page: 1, Size: 50, OrderBy: constant.OrderByCreatedAt}
		comments, svcerr := NewCommentService().GetCommentList(ctx, &req)
		if svcerr != nil {
			t.Fatalf("list: %v", svcerr)
		}
		return comments
	}
	zero := 0
	byID := func(comments []dto.CommentDto, id uint) dto.CommentDto {
		for _, c := range comments {
			if c.ID == id {
				return c
			}
		}
		t.Fatalf("comment %d missing", id)
		return dto.CommentDto{}
	}

	// 游客：看不到私密回复，摘要按出现先后列出回复者
	guestRoots := list(context.Background(), dto.GetCommentListReq{Depth: &zero})
	authorID, _ := ctxutils.GetCurrentUserID(author)
	adminID, _ := ctxutils.GetCurrentUserID(admin)
	summary := byID(guestRoots, root)
	if summary.ThreadCount != 2 || len(summary.ThreadUsers) != 2 || summary.ThreadUsers[0].ID != authorID || summary.ThreadUsers[1].ID != adminID {
		t.Fatalf("guest summary = %d %+v", summary.ThreadCount, summary.ThreadUsers)
	}
	if q := byID(guestRoots, quiet); q.ThreadCount != 0 || len(q.ThreadUsers) != 0 {
		t.Fatalf("quiet summary = %+v", q)
	}
	thread := list(context.Background(), dto.GetCommentListReq{RootID: root, Depth: &zero})
	if len(thread) != 2 || thread[0].ID != first || thread[1].ID != nested || thread[1].ReplyID != first {
		t.Fatalf("guest thread = %+v", thread)
	}
	// 文章作者可见全部回复
	if got := byID(list(author, dto.GetCommentListReq{Depth: &zero}), root).ThreadCount; got != 3 {
		t.Fatalf("author thread count = %d", got)
	}
	if got := list(author, dto.GetCommentListReq{RootID: root}); len(got) != 3 {
		t.Fatalf("author thread = %d", len(got))
	}
}
