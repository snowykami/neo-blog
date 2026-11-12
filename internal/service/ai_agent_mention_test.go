package service

import (
	"context"
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// mentionAs 以 ctx 的用户在文章下发一条 @ 评论（评论创建时同步安排 AI 运行）
func mentionAs(t *testing.T, ctx context.Context, postID uint, content string, ids ...uint) uint {
	t.Helper()
	id, svcerr := NewCommentService().CreateComment(ctx, &dto.CreateCommentReq{
		TargetID: postID, TargetType: constant.TargetTypePost, Content: content, MentionUserIDs: ids,
	})
	if svcerr != nil {
		t.Fatalf("create comment: %v", svcerr)
	}
	return id
}

func mentionRunsOf(t *testing.T, agentID uint) []model.AgentRun {
	t.Helper()
	runs, _, err := repo.AIAgent.ListRuns(&dto.ListAgentRunsReq{
		AgentID: agentID, Trigger: constant.AgentTriggerCommentMentioned, PaginationParams: dto.PaginationParams{Page: 1, Size: 100},
	})
	if err != nil {
		t.Fatalf("list runs: %v", err)
	}
	return runs
}

func runForComment(t *testing.T, agentID, commentID uint) model.AgentRun {
	t.Helper()
	for _, r := range mentionRunsOf(t, agentID) {
		if r.TargetID == commentID {
			return r
		}
	}
	t.Fatalf("no mention run for comment %d", commentID)
	return model.AgentRun{}
}

func countStatus(runs []model.AgentRun, status, reason string) int {
	n := 0
	for _, r := range runs {
		if r.Status == status && r.SkipReason == reason {
			n++
		}
	}
	return n
}

// 次数上限：同一用户每天 @ 同一 AI、每小时 @ 全部 AI 都有上限；管理员不受限
func TestAgentMentionCaps(t *testing.T) {
	admin, author, ai1, ai2, postID := setupAgentTest(t)
	for k, v := range map[string]any{"ai_agents_mentions_per_pair_per_day": 2, "ai_agents_mentions_per_user_per_hour": 3} {
		_ = repo.KV.SetKV(k, v)
	}
	for i := range 3 {
		mentionAs(t, author, postID, fmt.Sprintf("@ai_one 第 %d 次", i), ai1.User.ID)
	}
	runs := mentionRunsOf(t, ai1.ID)
	if countStatus(runs, constant.AgentRunStatusQueued, "") != 2 || countStatus(runs, constant.AgentRunStatusSkipped, "mention_pair_limit") != 1 {
		t.Fatalf("pair cap: %+v", runs)
	}
	// 每小时上限按全部 AI 合计：前面已占 2 次，ai2 只能再排 1 次
	mentionAs(t, author, postID, "@ai_two 你呢", ai2.User.ID)
	mentionAs(t, author, postID, "@ai_two 再问一次", ai2.User.ID)
	runs = mentionRunsOf(t, ai2.ID)
	if countStatus(runs, constant.AgentRunStatusQueued, "") != 1 || countStatus(runs, constant.AgentRunStatusSkipped, "mention_user_limit") != 1 {
		t.Fatalf("user hourly cap: %+v", runs)
	}
	// 其他用户各自计数
	other, _ := repo.User.GetUserByUsername("other")
	otherCtx := context.WithValue(context.Background(), "user_id", other.ID)
	c := mentionAs(t, otherCtx, postID, "@ai_one 我也想问", ai1.User.ID)
	if r := runForComment(t, ai1.ID, c); r.Status != constant.AgentRunStatusQueued {
		t.Fatalf("other user should not share caps: %+v", r)
	}
	// 管理员不受次数上限
	for i := range 4 {
		c := mentionAs(t, admin, postID, fmt.Sprintf("@ai_two 管理员测试 %d", i), ai2.User.ID)
		if r := runForComment(t, ai2.ID, c); r.Status != constant.AgentRunStatusQueued {
			t.Fatalf("admin mention %d: %+v", i, r)
		}
	}
	// 上限为 0 时不响应 @
	_ = repo.KV.SetKV("ai_agents_mentions_per_pair_per_day", 0)
	c = mentionAs(t, otherCtx, postID, "@ai_two 在吗", ai2.User.ID)
	if r := runForComment(t, ai2.ID, c); r.Status != constant.AgentRunStatusSkipped || r.SkipReason != "mention_pair_limit" {
		t.Fatalf("zero cap: %+v", r)
	}
}

// 同一条评论对同一个 AI 只安排一次：即使数据库里的记录没了（或其他实例并发处理），共享状态里的去重键仍然生效
func TestAgentMentionDedupe(t *testing.T) {
	_, author, ai1, _, postID := setupAgentTest(t)
	c := mentionAs(t, author, postID, "@ai_one 看看这个", ai1.User.ID)
	repo.GetDB().Where("target_id = ?", c).Delete(&model.AgentRun{})
	NewAIAgentService().OnCommentMentioned(c, time.Now())
	if runs := mentionRunsOf(t, ai1.ID); len(runs) != 0 {
		t.Fatalf("duplicate mention queued again: %+v", runs)
	}
}

// 今天的评论额度用完的 AI 不再因为 @ 被唤醒（不浪费模型调用），也不占用户的次数名额
func TestAgentMentionQuotaExhausted(t *testing.T) {
	_, author, ai1, _, postID := setupAgentTest(t)
	_ = repo.KV.SetKV("ai_agents_comments_per_day", 0)
	c := mentionAs(t, author, postID, "@ai_one 今天还能说话吗", ai1.User.ID)
	if r := runForComment(t, ai1.ID, c); r.Status != constant.AgentRunStatusSkipped || r.SkipReason != "daily_comment_limit" {
		t.Fatalf("quota exhausted: %+v", r)
	}
	authorID, _ := author.Value("user_id").(uint)
	if v, ok, _ := sharedstate.Current().Get(mentionPairKey(authorID, ai1.User.ID, time.Now())); ok && v != "0" {
		t.Fatalf("skipped mention should not take a slot, got %s", v)
	}
}

// dueClaim 让任务立即到点并领取，返回领取后的运行记录
func dueClaim(t *testing.T, runID uint) model.AgentRun {
	t.Helper()
	repo.GetDB().Model(&model.AgentRun{}).Where("id = ?", runID).Update("scheduled_at", time.Now().Add(-time.Minute))
	if _, err := NewAIAgentService().ClaimRuns(context.Background(), 10); err != nil {
		t.Fatalf("claim: %v", err)
	}
	run, err := repo.AIAgent.GetRun(runID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	return *run
}

// 执行前重新核对目标：评论入队后改为私密、被删除，或所在文章不再公开时，运行记为跳过
func TestAgentMentionTargetRecheckedAtLease(t *testing.T) {
	_, author, ai1, ai2, postID := setupAgentTest(t)

	// 评论改为私密
	c1 := mentionAs(t, author, postID, "@ai_one 先公开问一下", ai1.User.ID)
	repo.GetDB().Model(&model.Comment{}).Where("id = ?", c1).Update("is_private", true)
	if r := dueClaim(t, runForComment(t, ai1.ID, c1).ID); r.Status != constant.AgentRunStatusSkipped || r.SkipReason != "comment_private" {
		t.Fatalf("private comment: %+v", r)
	}

	// 评论被删除
	c2 := mentionAs(t, author, postID, "@ai_two 这条马上删", ai2.User.ID)
	repo.GetDB().Delete(&model.Comment{}, c2)
	if r := dueClaim(t, runForComment(t, ai2.ID, c2).ID); r.Status != constant.AgentRunStatusSkipped || r.SkipReason != "comment_deleted" {
		t.Fatalf("deleted comment: %+v", r)
	}

	// 所在文章改为私密
	c3 := mentionAs(t, author, postID, "@ai_one 文章要下线了", ai1.User.ID)
	repo.GetDB().Model(&model.Post{}).Where("id = ?", postID).Update("is_private", true)
	if r := dueClaim(t, runForComment(t, ai1.ID, c3).ID); r.Status != constant.AgentRunStatusSkipped || r.SkipReason != "target_private" {
		t.Fatalf("private post: %+v", r)
	}

	// 被回复的运行同样核对
	repo.GetDB().Model(&model.Post{}).Where("id = ?", postID).Update("is_private", false)
	ctx, _ := leaseCtx(t, ai2.ID, constant.AgentRunKindBrowse)
	aiComment, svcerr := NewAIAgentService().AgentCreateComment(ctx, constant.TargetTypePost, postID, 0, "这个思路挺有意思")
	if svcerr != nil {
		t.Fatalf("ai comment: %v", svcerr)
	}
	repo.GetDB().Model(&model.AgentRun{}).Where("status = ?", constant.AgentRunStatusLeased).Update("status", constant.AgentRunStatusDone)
	reply, svcerr := createComment(author, postID, aiComment, false)
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	repo.GetDB().Model(&model.Comment{}).Where("id = ?", reply).Update("is_private", true)
	replied, _, _ := repo.AIAgent.ListRuns(&dto.ListAgentRunsReq{AgentID: ai2.ID, Trigger: constant.AgentTriggerCommentReplied, PaginationParams: dto.PaginationParams{Page: 1, Size: 10}})
	if len(replied) != 1 {
		t.Fatalf("replied runs = %+v", replied)
	}
	if r := dueClaim(t, replied[0].ID); r.Status != constant.AgentRunStatusSkipped || r.SkipReason != "comment_private" {
		t.Fatalf("private reply: %+v", r)
	}

	// 目标仍公开时正常领取
	c4 := mentionAs(t, author, postID, "@ai_one 这次是公开的", ai1.User.ID)
	if r := dueClaim(t, runForComment(t, ai1.ID, c4).ID); r.Status != constant.AgentRunStatusLeased {
		t.Fatalf("public mention should be leased: %+v", r)
	}
}

// 执行前额度已用完：被 @ 的运行直接跳过，不调用模型
func TestAgentMentionQuotaRecheckedAtLease(t *testing.T) {
	_, author, ai1, _, postID := setupAgentTest(t)
	c := mentionAs(t, author, postID, "@ai_one 晚点回我", ai1.User.ID)
	_ = repo.KV.SetKV("ai_agents_comments_per_day", 0)
	if r := dueClaim(t, runForComment(t, ai1.ID, c).ID); r.Status != constant.AgentRunStatusSkipped || r.SkipReason != "daily_comment_limit" {
		t.Fatalf("quota at lease: %+v", r)
	}
}

// 预留额度：本小时模型调用到达预留线后，评论触发的运行顺延到下个小时，文章发布等其他运行不受影响
func TestAgentUserTriggeredBudgetReserve(t *testing.T) {
	_, author, ai1, ai2, postID := setupAgentTest(t)
	_ = repo.KV.SetKV("ai_agents_llm_calls_per_hour", 10)
	c := mentionAs(t, author, postID, "@ai_one 帮忙看看", ai1.User.ID)
	now := time.Now()
	_ = sharedstate.Current().Set(hourKey(now), strconv.Itoa(8), time.Hour)
	published := model.AgentRun{AgentID: ai2.ID, Kind: constant.AgentRunKindEvent, Trigger: constant.AgentTriggerPostPublished,
		TargetType: constant.TargetTypePost, TargetID: postID, Status: constant.AgentRunStatusQueued, ScheduledAt: now.Add(-time.Minute)}
	if err := repo.AIAgent.CreateRun(&published); err != nil {
		t.Fatal(err)
	}
	r := dueClaim(t, runForComment(t, ai1.ID, c).ID)
	if r.Status != constant.AgentRunStatusQueued || !r.ScheduledAt.After(now.Truncate(time.Hour).Add(time.Hour-time.Second)) {
		t.Fatalf("mention run should be postponed: %+v", r)
	}
	if p, _ := repo.AIAgent.GetRun(published.ID); p.Status != constant.AgentRunStatusLeased {
		t.Fatalf("post published run should be leased: %+v", p)
	}
}

// 编辑评论：新加的 @ 与私密改为公开后的 @ 会唤醒 AI；同一条评论对同一个 AI 只安排一次，反复编辑不重复唤醒
func TestAgentMentionAfterEdit(t *testing.T) {
	_, author, ai1, ai2, postID := setupAgentTest(t)
	svc := NewCommentService()
	edit := func(id uint, content string, private bool, ids ...uint) {
		t.Helper()
		if svcerr := svc.UpdateComment(author, &dto.UpdateCommentReq{ID: id, Content: content, IsPrivate: private, MentionUserIDs: &ids}); svcerr != nil {
			t.Fatalf("update comment: %v", svcerr)
		}
	}

	id := mentionAs(t, author, postID, "还没点名")
	if runs := mentionRunsOf(t, ai1.ID); len(runs) != 0 {
		t.Fatalf("runs before edit: %+v", runs)
	}
	edit(id, "@ai_one 你怎么看", false, ai1.User.ID)
	if run := runForComment(t, ai1.ID, id); run.Status != constant.AgentRunStatusQueued {
		t.Fatalf("run after adding mention: %+v", run)
	}
	edit(id, "@ai_one 你怎么看？改个错字", false, ai1.User.ID)
	if runs := mentionRunsOf(t, ai1.ID); len(runs) != 1 {
		t.Fatalf("re-edit should not schedule again: %+v", runs)
	}

	// 私密评论里的 @ 不唤醒，改为公开后再按被 @ 处理
	private, svcerr := svc.CreateComment(author, &dto.CreateCommentReq{
		TargetID: postID, TargetType: constant.TargetTypePost, Content: "@ai_two 悄悄问", IsPrivate: true, MentionUserIDs: []uint{ai2.User.ID},
	})
	if svcerr != nil {
		t.Fatalf("create private comment: %v", svcerr)
	}
	if runs := mentionRunsOf(t, ai2.ID); len(runs) != 0 {
		t.Fatalf("private comment should not schedule: %+v", runs)
	}
	edit(private, "@ai_two 悄悄问", false, ai2.User.ID)
	if run := runForComment(t, ai2.ID, private); run.Status != constant.AgentRunStatusQueued {
		t.Fatalf("run after making public: %+v", run)
	}
}
