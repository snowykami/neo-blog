package service

import (
	"context"
	"net/http"
	"testing"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
)

func assertServiceForbidden(t *testing.T, svcerr *errs.ServiceError, wantMessage, label string) {
	t.Helper()
	if svcerr == nil {
		t.Fatalf("%s: expected error %q, got nil", label, wantMessage)
	}
	if svcerr.Code != http.StatusForbidden {
		t.Fatalf("%s: status = %d, want 403 (%v)", label, svcerr.Code, svcerr)
	}
	if svcerr.Message != wantMessage {
		t.Fatalf("%s: message = %q, want %q", label, svcerr.Message, wantMessage)
	}
}

func assertSiteInfoInteraction(t *testing.T, wantEnabled, wantComment, wantLike bool) {
	t.Helper()
	info := NewMiscService().GetSiteInfo()
	raw, ok := info["interaction"].(map[string]any)
	if !ok {
		t.Fatalf("site info missing interaction map: %#v", info["interaction"])
	}
	if raw["enabled"] != wantEnabled || raw["comment"] != wantComment || raw["like"] != wantLike {
		t.Fatalf("site info interaction = %#v, want enabled=%v comment=%v like=%v", raw, wantEnabled, wantComment, wantLike)
	}
}

func saveInteractionConfig(t *testing.T, changes ...config.Change) {
	t.Helper()
	if svcerr := config.Save(changes); svcerr != nil {
		t.Fatalf("config.Save(%+v): %v", changes, svcerr)
	}
}

func TestInteractionSwitch(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	otherID, _ := ctxutils.GetCurrentUserID(other)

	// 默认全开启
	if !tools.InteractionEnabled() || !tools.CommentEnabled() || !tools.LikeEnabled() {
		t.Fatalf("expected interaction switches default true, got interaction=%v comment=%v like=%v",
			tools.InteractionEnabled(), tools.CommentEnabled(), tools.LikeEnabled())
	}
	assertSiteInfoInteraction(t, true, true, true)

	// 创建公开文章、评论与点赞基线数据
	postID := createPublicPost(t, author, nil)
	commentService := NewCommentService()
	likeService := NewLikeService()

	commentID, svcerr := commentService.CreateComment(other, &dto.CreateCommentReq{
		TargetID:   postID,
		TargetType: constant.TargetTypePost,
		Content:    "interaction switch baseline comment",
	})
	if svcerr != nil {
		t.Fatalf("create baseline comment: %v", svcerr)
	}

	wantLiked := true
	if liked, svcerr := likeService.ToggleLike(other, postID, constant.TargetTypePost, &wantLiked); svcerr != nil || !liked {
		t.Fatalf("like post: liked=%v err=%v", liked, svcerr)
	}
	if liked, svcerr := likeService.ToggleLike(other, commentID, constant.TargetTypeComment, &wantLiked); svcerr != nil || !liked {
		t.Fatalf("like comment: liked=%v err=%v", liked, svcerr)
	}

	// 验证全站搜索在评论开启时能命中基线评论
	searchResp, svcerr := NewSearchService().GlobalSearch(other, &dto.GlobalSearchReq{
		Query: "baseline",
		Types: "comments",
	}, "127.0.0.1")
	if svcerr != nil || len(searchResp.Comments) != 1 {
		t.Fatalf("baseline comment search: len=%d err=%v", len(searchResp.Comments), svcerr)
	}

	// 1. 仅关闭评论开关：不删数据、拦截用户读写与搜索，保留管理员列表与详情查看
	saveInteractionConfig(t, config.Change{Key: "enable_comment", Value: false})
	assertSiteInfoInteraction(t, true, false, true)

	_, svcerr = commentService.CreateComment(other, &dto.CreateCommentReq{
		TargetID:   postID,
		TargetType: constant.TargetTypePost,
		Content:    "blocked comment",
	})
	assertServiceForbidden(t, svcerr, "comment_disabled", "CreateComment")
	assertServiceForbidden(t, commentService.UpdateComment(other, &dto.UpdateCommentReq{ID: commentID, Content: "edited"}), "comment_disabled", "UpdateComment")
	depth := 0
	_, svcerr = commentService.GetCommentList(other, &dto.GetCommentListReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt},
		TargetID:         postID,
		TargetType:       constant.TargetTypePost,
		Depth:            &depth,
	})
	assertServiceForbidden(t, svcerr, "comment_disabled", "GetCommentList")
	_, svcerr = commentService.GetComment(other, commentID)
	assertServiceForbidden(t, svcerr, "comment_disabled", "GetComment non-admin")
	assertServiceForbidden(t, commentService.DeleteComment(other, commentID), "comment_disabled", "DeleteComment non-admin")
	_, _, svcerr = commentService.ListUserComments(other, &dto.ListUserCommentsReq{
		UserID:           otherID,
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt},
	})
	assertServiceForbidden(t, svcerr, "comment_disabled", "ListUserComments non-admin")
	_, svcerr = NewCommentTranslateService().Translate(other, &dto.TranslateCommentReq{ID: commentID, TargetLang: "en"})
	assertServiceForbidden(t, svcerr, "comment_disabled", "CommentTranslate")
	_, svcerr = likeService.ToggleLike(other, commentID, constant.TargetTypeComment, &wantLiked)
	assertServiceForbidden(t, svcerr, "comment_disabled", "ToggleLike comment while comment disabled")

	searchResp, svcerr = NewSearchService().GlobalSearch(other, &dto.GlobalSearchReq{
		Query: "baseline",
		Types: "comments",
	}, "127.0.0.1")
	if svcerr != nil || len(searchResp.Comments) != 0 {
		t.Fatalf("expected 0 comments in search when disabled, got %d (err=%v)", len(searchResp.Comments), svcerr)
	}

	// 数据库评论计数与记录完好；管理员后台与管理详情仍可用
	if post := reloadPost(t, postID); post.CommentCount != 1 {
		t.Fatalf("post CommentCount = %d, want 1 preserved", post.CommentCount)
	}
	adminItems, adminTotal, svcerr := commentService.ListCommentsAdmin(admin, &dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt}, "")
	if svcerr != nil || adminTotal != 1 || len(adminItems) != 1 {
		t.Fatalf("ListCommentsAdmin while disabled: len=%d total=%d err=%v", len(adminItems), adminTotal, svcerr)
	}
	if _, svcerr := commentService.GetComment(admin, commentID); svcerr != nil {
		t.Fatalf("admin GetComment while disabled: %v", svcerr)
	}

	// AI 发评也被拦
	aiUser := &model.User{Username: "ai_switch_bot", Email: "ai_switch@test.local", Role: constant.RoleUser, IsAI: true}
	if err := repo.GetDB().Create(aiUser).Error; err != nil {
		t.Fatalf("create AI user: %v", err)
	}
	agent := &model.AIAgent{UserID: aiUser.ID, Status: "active"}
	if err := repo.GetDB().Create(agent).Error; err != nil {
		t.Fatalf("create AI agent: %v", err)
	}
	agentCtx := ctxutils.WithAgentRun(context.WithValue(context.Background(), "user_id", aiUser.ID), &ctxutils.AgentRunInfo{
		AgentID: agent.ID,
		UserID:  aiUser.ID,
	})
	_, svcerr = NewAIAgentService().AgentCreateComment(agentCtx, constant.TargetTypePost, postID, 0, "ai comment")
	assertServiceForbidden(t, svcerr, "comment_disabled", "AgentCreateComment")

	// 重新开启评论开关：历史评论立即可见
	saveInteractionConfig(t, config.Change{Key: "enable_comment", Value: true})
	assertSiteInfoInteraction(t, true, true, true)
	comments, svcerr := commentService.GetCommentList(other, &dto.GetCommentListReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt},
		TargetID:         postID,
		TargetType:       constant.TargetTypePost,
		Depth:            &depth,
	})
	if svcerr != nil || len(comments) != 1 || comments[0].ID != commentID {
		t.Fatalf("comments after re-enabling = %+v, err=%v", comments, svcerr)
	}

	// 2. 仅关闭点赞开关：拦截点赞与查询、屏蔽评论点赞数，但允许管理员撤回 AI 历史点赞
	if liked, svcerr := likeService.ToggleLike(agentCtx, postID, constant.TargetTypePost, &wantLiked); svcerr != nil || !liked {
		t.Fatalf("AI seed like before disable: liked=%v err=%v", liked, svcerr)
	}
	run := &model.AgentRun{
		AgentID: agent.ID,
		Kind:    "schedule",
		Status:  "done",
		Effects: mustJSON([]dto.AgentEffectDto{{Type: "like", TargetType: constant.TargetTypePost, TargetID: postID, Liked: true}}),
	}
	if err := repo.GetDB().Create(run).Error; err != nil {
		t.Fatalf("create AgentRun: %v", err)
	}

	saveInteractionConfig(t, config.Change{Key: "enable_like", Value: false})
	assertSiteInfoInteraction(t, true, true, false)

	_, svcerr = likeService.ToggleLike(other, postID, constant.TargetTypePost, &wantLiked)
	assertServiceForbidden(t, svcerr, "like_disabled", "ToggleLike")
	_, svcerr = likeService.IsLiked(other, postID, constant.TargetTypePost)
	assertServiceForbidden(t, svcerr, "like_disabled", "IsLiked")
	_, svcerr = likeService.GetLikedUsers(other, postID, constant.TargetTypePost, 10)
	assertServiceForbidden(t, svcerr, "like_disabled", "GetLikedUsers")
	_, _, svcerr = likeService.ListUserLikes(other, &dto.ListUserLikesReq{
		UserID:           otherID,
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt},
	})
	assertServiceForbidden(t, svcerr, "like_disabled", "ListUserLikes non-admin")
	_, svcerr = NewAIAgentService().AgentSetLike(agentCtx, constant.TargetTypePost, postID, false)
	assertServiceForbidden(t, svcerr, "like_disabled", "AgentSetLike")

	// 点赞关闭时评论列表应屏蔽评论的点赞状态与点赞数
	maskedComments, svcerr := commentService.GetCommentList(other, &dto.GetCommentListReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt},
		TargetID:         postID,
		TargetType:       constant.TargetTypePost,
		Depth:            &depth,
	})
	if svcerr != nil || len(maskedComments) != 1 {
		t.Fatalf("GetCommentList with likes disabled: len=%d err=%v", len(maskedComments), svcerr)
	}
	if maskedComments[0].IsLiked || maskedComments[0].LikeCount != 0 {
		t.Fatalf("expected masked comment like fields (false/0), got IsLiked=%v LikeCount=%d",
			maskedComments[0].IsLiked, maskedComments[0].LikeCount)
	}

	// 管理员仍可在关闭点赞期间撤回 AI 历史运行产生的点赞
	if _, svcerr := NewAIAgentService().RevertRun(admin, run.ID); svcerr != nil {
		t.Fatalf("RevertRun while likes disabled: %v", svcerr)
	}
	if post := reloadPost(t, postID); post.LikeCount != 1 {
		t.Fatalf("post LikeCount after RevertRun = %d, want 1 (other user's like preserved)", post.LikeCount)
	}

	// 重新开启点赞后历史点赞完整恢复
	saveInteractionConfig(t, config.Change{Key: "enable_like", Value: true})
	if liked, svcerr := likeService.IsLiked(other, commentID, constant.TargetTypeComment); svcerr != nil || !liked {
		t.Fatalf("expected comment like preserved after re-enable, got liked=%v err=%v", liked, svcerr)
	}
	restoredComments, svcerr := commentService.GetCommentList(other, &dto.GetCommentListReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: constant.OrderByCreatedAt},
		TargetID:         postID,
		TargetType:       constant.TargetTypePost,
		Depth:            &depth,
	})
	if svcerr != nil || len(restoredComments) != 1 || !restoredComments[0].IsLiked || restoredComments[0].LikeCount != 1 {
		t.Fatalf("expected restored comment like state (true/1), got %+v err=%v", restoredComments, svcerr)
	}

	// 3. 总开关关闭（配置项与环境变量均能覆盖子开关）
	saveInteractionConfig(t, config.Change{Key: "enable_interaction", Value: false})
	if tools.InteractionEnabled() || tools.CommentEnabled() || tools.LikeEnabled() {
		t.Fatalf("expected all switches false when master config off, got interaction=%v comment=%v like=%v",
			tools.InteractionEnabled(), tools.CommentEnabled(), tools.LikeEnabled())
	}
	assertSiteInfoInteraction(t, false, false, false)

	saveInteractionConfig(t, config.Change{Key: "enable_interaction", Value: true})
	assertSiteInfoInteraction(t, true, true, true)

	t.Setenv(constant.EnvKeyEnableInteraction, "false")
	if tools.InteractionEnabled() || tools.CommentEnabled() || tools.LikeEnabled() {
		t.Fatalf("expected env ENABLE_INTERACTION=false to disable all, got interaction=%v comment=%v like=%v",
			tools.InteractionEnabled(), tools.CommentEnabled(), tools.LikeEnabled())
	}
	assertSiteInfoInteraction(t, false, false, false)
}
