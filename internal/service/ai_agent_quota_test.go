package service

import (
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 单篇的 AI 评论名额只算 AI 的顶层评论与 AI 之间的回复；AI 回复真人另有上限（每条真人评论最多被 AI 回复几次），
// 单篇满了也能回应真人；每个 AI 的单篇上限只算顶层评论
func TestAgentHumanReplyQuota(t *testing.T) {
	admin, author, ai1, ai2, postID := setupAgentTest(t)
	for k, v := range map[string]any{"ai_agents_comments_per_post": 1, "ai_agents_ai_ratio": 0, "ai_agents_replies_per_human_comment": 1, "ai_agents_pair_exchanges": 10} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatal(err)
		}
	}
	svc := NewAIAgentService()
	comment := func(agentID uint, replyID uint, content string) (uint, string) {
		t.Helper()
		ctx, _ := leaseCtx(t, agentID, constant.AgentRunKindBrowse)
		id, svcerr := svc.AgentCreateComment(ctx, constant.TargetTypePost, postID, replyID, content)
		if svcerr != nil {
			return 0, svcerr.Message
		}
		return id, ""
	}

	// 单篇名额为 1：第一个 AI 评论后满了
	aiTop, msg := comment(ai1.ID, 0, "离线库的思路很清楚，打包进二进制很方便")
	if msg != "" {
		t.Fatalf("first ai comment: %s", msg)
	}
	if _, msg := comment(ai2.ID, 0, "我更关心数据文件多久更新一次"); msg != "agent_post_comment_limit" {
		t.Fatalf("post limit not enforced: %q", msg)
	}
	// AI 之间的回复仍占单篇名额
	if _, msg := comment(ai2.ID, aiTop, "同意，嵌入资源之后部署就简单了"); msg != "agent_post_comment_limit" {
		t.Fatalf("ai-to-ai reply should count toward the post limit: %q", msg)
	}

	// 单篇满了也能回复真人，回复真人单独计数
	human, svcerr := createComment(author, postID, 0, false)
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	if _, msg := comment(ai2.ID, human, "这个问题我之前也遇到过，换成增量更新就好了"); msg != "" {
		t.Fatalf("reply to a human should be allowed when the post limit is full: %q", msg)
	}
	// 同一条真人评论被 AI 回复的次数达到上限
	if _, msg := comment(ai1.ID, human, "补充一点，可以在启动时校验文件版本"); msg != "agent_human_reply_limit" {
		t.Fatalf("human reply limit not enforced: %q", msg)
	}
	// 回复真人的评论不计入单篇的 AI 评论数
	if aiCount, humanCount, _ := repo.AIAgent.CountTargetComments(constant.TargetTypePost, postID); aiCount != 1 || humanCount != 1 {
		t.Fatalf("counts = ai %d, human %d", aiCount, humanCount)
	}

	// 个体的单篇上限只算顶层评论：ai2 回复过真人，仍可以发自己的顶层评论（放开单篇名额后）
	if err := repo.KV.SetKV("ai_agents_comments_per_post", 10); err != nil {
		t.Fatal(err)
	}
	profile := ai2.Profile
	profile.Limits.CommentsPerPost = 1
	if _, svcerr := svc.Update(admin, &dto.UpdateAIAgentReq{ID: ai2.ID, Profile: &profile}); svcerr != nil {
		t.Fatalf("update profile: %v", svcerr)
	}
	if _, msg := comment(ai2.ID, 0, "整体结构清晰，示例代码也很容易跟着做"); msg != "" {
		t.Fatalf("replies should not use up the agent's per-post limit: %q", msg)
	}
	if _, msg := comment(ai2.ID, 0, "顺便问一下有没有考虑过压缩体积"); msg != "agent_post_comment_limit" {
		t.Fatalf("agent per-post limit not enforced: %q", msg)
	}
}
