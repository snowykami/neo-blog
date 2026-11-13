package service

import (
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestUpdateCommentMaintainsPrivateSubtreeInvariant(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	svc := NewCommentService()

	// 1) 私密根评论下的回复编辑时尝试改为公开：仍保持私密
	rootID, svcerr := svc.CreateComment(other, &dto.CreateCommentReq{
		TargetType: constant.TargetTypePost,
		TargetID:   postID,
		Content:    "secret root",
		IsPrivate:  true,
	})
	if svcerr != nil {
		t.Fatalf("create private root: %v", svcerr)
	}
	replyID, svcerr := svc.CreateComment(author, &dto.CreateCommentReq{
		TargetType: constant.TargetTypePost,
		TargetID:   postID,
		ReplyID:    rootID,
		Content:    "reply under secret",
		IsPrivate:  false,
	})
	if svcerr != nil {
		t.Fatalf("create reply: %v", svcerr)
	}
	if svcerr := svc.UpdateComment(author, &dto.UpdateCommentReq{
		ID:        replyID,
		Content:   "edited reply trying to go public",
		IsPrivate: false,
	}); svcerr != nil {
		t.Fatalf("update reply: %v", svcerr)
	}
	reply, err := repo.Comment.GetComment(replyID)
	if err != nil || !reply.IsPrivate {
		t.Fatalf("reply under private root must stay private, got err=%v is_private=%v", err, reply != nil && reply.IsPrivate)
	}

	// 2) 公开根评论下已有公开回复，随后根评论被改为私密：子树回复级联变为私密
	pubRootID, svcerr := svc.CreateComment(other, &dto.CreateCommentReq{
		TargetType: constant.TargetTypePost,
		TargetID:   postID,
		Content:    "public root",
		IsPrivate:  false,
	})
	if svcerr != nil {
		t.Fatalf("create public root: %v", svcerr)
	}
	pubReplyID, svcerr := svc.CreateComment(author, &dto.CreateCommentReq{
		TargetType: constant.TargetTypePost,
		TargetID:   postID,
		ReplyID:    pubRootID,
		Content:    "public reply",
		IsPrivate:  false,
	})
	if svcerr != nil {
		t.Fatalf("create public reply: %v", svcerr)
	}
	if svcerr := svc.UpdateComment(other, &dto.UpdateCommentReq{
		ID:        pubRootID,
		Content:   "now private root",
		IsPrivate: true,
	}); svcerr != nil {
		t.Fatalf("update public root to private: %v", svcerr)
	}
	cascaded, err := repo.Comment.GetComment(pubReplyID)
	if err != nil || !cascaded.IsPrivate {
		t.Fatalf("public reply should cascade to private when root becomes private, got err=%v is_private=%v", err, cascaded != nil && cascaded.IsPrivate)
	}
}
