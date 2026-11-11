package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// fakePersonaModel 模拟 OpenAI 兼容接口：返回 10 个不同昵称的人设与固定用量；fail 为 true 时返回 500
func fakePersonaModel(t *testing.T) (calls *atomic.Int32, fail *atomic.Bool) {
	t.Helper()
	calls, fail = &atomic.Int32{}, &atomic.Bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if fail.Load() {
			http.Error(w, "upstream down", http.StatusInternalServerError)
			return
		}
		personas := make([]map[string]any, 10)
		for i := range personas {
			personas[i] = map[string]any{
				"nickname": fmt.Sprintf("网友%d_%d", n, i), "persona": "我是一个爱看技术文章的普通上班族，偶尔留言。",
				"interests": []string{"Go"}, "tone": "随和", "style_samples": []string{"学到了"},
			}
		}
		content, _ := json.Marshal(personas)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": string(content)}}},
			"usage":   map[string]any{"prompt_tokens": 100, "completion_tokens": 50},
		})
	}))
	t.Cleanup(server.Close)
	for k, v := range map[string]any{"ai_api_base_url": server.URL, "ai_api_key": "k", "ai_model": "m"} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatal(err)
		}
	}
	return calls, fail
}

func groupTemplateJSON() string {
	return mustJSON(dto.AIAgentGroupTemplate{
		Tier:       constant.AIAgentTierAmbient,
		Archetypes: []dto.AIAgentArchetype{{Name: "潜水党", Ratio: 1, DailyActionsMin: 1, DailyActionsMax: 2, Comment: 0.2}},
	})
}

func backgroundRuns(t *testing.T, trigger string) []model.AgentRun {
	t.Helper()
	var runs []model.AgentRun
	if err := repo.GetDB().Where("kind = ? AND trigger_type = ?", constant.AgentRunKindBackground, trigger).Find(&runs).Error; err != nil {
		t.Fatal(err)
	}
	return runs
}

// 群体生成中途实例退出（任务令牌过期）：job_recovery 从已创建的数量接着生成，不多建；令牌仍被持有时不接手。
// 失败的群体可以手动继续生成
func TestAIAgentGroupGenerationResume(t *testing.T) {
	admin, _, _, _, _ := setupAgentTest(t)
	calls, fail := fakePersonaModel(t)
	svc := NewAIAgentService()

	// 模拟中断：已创建 13 个（库里有记录），共 25 个，没有实例持有令牌
	group := &model.AIAgentGroup{Name: "g", Template: groupTemplateJSON(), Status: groupStatusGen, Total: 25, Created: 13}
	if err := repo.AIAgent.CreateGroup(group); err != nil {
		t.Fatal(err)
	}
	list, svcerr := svc.ListGroups(admin)
	if svcerr != nil || len(list) != 1 || !list[0].Interrupted {
		t.Fatalf("interrupted group should be reported: %+v %v", list, svcerr)
	}

	// 令牌仍被其他实例持有：不接手
	lease, err := sharedstate.AcquireLease(groupLeaseKey(group.ID), time.Minute)
	if err != nil || lease == nil {
		t.Fatalf("acquire lease: %v", err)
	}
	ResumeAIAgentGroups()
	if calls.Load() != 0 {
		t.Fatal("group held by another instance should not be resumed")
	}
	if g, _ := svc.GetGroup(admin, group.ID); g.Interrupted {
		t.Fatal("group with a live lease is not interrupted")
	}
	lease.Release()

	ResumeAIAgentGroups()
	g, _ := repo.AIAgent.GetGroup(group.ID)
	if g.Status != groupStatusDone || g.Created != 25 {
		t.Fatalf("resumed group = %+v", g)
	}
	counts, _ := repo.AIAgent.GroupCounts()
	if counts[group.ID][0] != 12 {
		t.Fatalf("created agents = %d, want the remaining 12", counts[group.ID][0])
	}
	if calls.Load() != 2 {
		t.Fatalf("model calls = %d, want 2 batches", calls.Load())
	}
	// 人设生成的用量记为「后台任务」，计入本月全站用量
	runs := backgroundRuns(t, constant.AgentTriggerGroupGenerate)
	if len(runs) != 2 || runs[0].AgentID != 0 || runs[0].PromptTokens != 100 || runs[0].CompletionTokens != 50 || runs[0].Status != constant.AgentRunStatusDone {
		t.Fatalf("background runs = %+v", runs)
	}
	if stats, _ := svc.Stats(admin); stats.MonthTokens != 300 {
		t.Fatalf("month tokens = %d, want 300", stats.MonthTokens)
	}

	// 生成失败（模型出错）：标记失败；恢复后可以从已创建的数量继续
	fail.Store(true)
	failed := &model.AIAgentGroup{Name: "f", Template: groupTemplateJSON(), Status: groupStatusGen, Total: 5}
	if err := repo.AIAgent.CreateGroup(failed); err != nil {
		t.Fatal(err)
	}
	ResumeAIAgentGroups()
	if g, _ := repo.AIAgent.GetGroup(failed.ID); g.Status != groupStatusFailed || g.Error == "" {
		t.Fatalf("group should fail: %+v", g)
	}
	if _, svcerr := svc.ResumeGroup(admin, group.ID); svcerr == nil {
		t.Fatal("only failed groups can be resumed")
	}
	fail.Store(false)
	if _, svcerr := svc.ResumeGroup(admin, failed.ID); svcerr != nil {
		t.Fatalf("resume failed group: %v", svcerr)
	}
	if g, _ := repo.AIAgent.GetGroup(failed.ID); g.Status != groupStatusDone || g.Created != 5 || g.Error != "" {
		t.Fatalf("resumed failed group = %+v", g)
	}
	if failedRuns := backgroundRuns(t, constant.AgentTriggerGroupGenerate); len(failedRuns) < 4 {
		t.Fatalf("failed calls should be recorded too: %d", len(failedRuns))
	}
}

// 记忆整理与人设生成走与 worker 相同的预算：每小时调用数计入同一个计数，超出后不再调用模型
func TestAIAgentBackgroundCallsUseBudget(t *testing.T) {
	_, _, ai1, _, _ := setupAgentTest(t)
	calls, _ := fakePersonaModel(t)
	if err := repo.KV.SetKV("ai_agents_llm_calls_per_hour", 2); err != nil {
		t.Fatal(err)
	}
	slots := []personaSlot{{Archetype: "a"}}
	if _, err := generatePersonas(context.Background(), slots, dto.AIAgentGroupTemplate{}); err != nil {
		t.Fatalf("first call: %v", err)
	}
	if hourLLMCalls(time.Now()) != 1 {
		t.Fatalf("hourly calls = %d", hourLLMCalls(time.Now()))
	}
	agent, err := repo.AIAgent.GetByID(ai1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.AIAgent.CreateMemory(&model.AgentMemory{AgentID: agent.ID, Kind: "episode", Content: "回复了一篇关于 Go 的文章"}); err != nil {
		t.Fatal(err)
	}
	// 记忆整理是这一小时的第 2 次调用，用量记在这个 AI 用户名下（模型输出不是合法 JSON，整理失败，但调用已计入）
	_ = NewAIAgentService().ConsolidateMemories(context.Background(), agent, time.Now())
	runs := backgroundRuns(t, constant.AgentTriggerMemoryConsolidate)
	if len(runs) != 1 || runs[0].AgentID != agent.ID || runs[0].PromptTokens != 100 {
		t.Fatalf("consolidation runs = %+v", runs)
	}
	if tokens, _ := repo.AIAgent.SumTokensByAgent([]uint{agent.ID}, monthStart(time.Now())); tokens[agent.ID] != 150 {
		t.Fatalf("agent tokens = %v", tokens)
	}
	// 第 3 次超出每小时上限：不调用模型
	before := calls.Load()
	if _, err := generatePersonas(context.Background(), slots, dto.AIAgentGroupTemplate{}); !errors.Is(err, ErrAgentLLMBudget) {
		t.Fatalf("over budget should fail with ErrAgentLLMBudget, got %v", err)
	}
	if calls.Load() != before {
		t.Fatal("model should not be called when over budget")
	}
	// 行为日志按「无视」筛选时不含后台任务
	none, _, _ := repo.AIAgent.ListRuns(&dto.ListAgentRunsReq{Action: "none", PaginationParams: dto.PaginationParams{Page: 1, Size: 50}})
	for _, r := range none {
		if r.Kind == constant.AgentRunKindBackground {
			t.Fatalf("background run listed as ignored: %+v", r)
		}
	}
}

// 有人回复 AI 的评论：与 @ 共用「同一用户每天找同一个 AI」的名额，超出时记为跳过；管理员不受限
func TestAgentReplyPairLimit(t *testing.T) {
	admin, author, ai1, _, postID := setupAgentTest(t)
	if err := repo.KV.SetKV("ai_agents_mentions_per_pair_per_day", 2); err != nil {
		t.Fatal(err)
	}
	ctx, _ := leaseCtx(t, ai1.ID, constant.AgentRunKindBrowse)
	aiComment, svcerr := NewAIAgentService().AgentCreateComment(ctx, constant.TargetTypePost, postID, 0, "离线库打包进二进制确实省心")
	if svcerr != nil {
		t.Fatalf("ai comment: %v", svcerr)
	}
	repliedRuns := func() []model.AgentRun {
		runs, _, err := repo.AIAgent.ListRuns(&dto.ListAgentRunsReq{AgentID: ai1.ID, Trigger: constant.AgentTriggerCommentReplied, PaginationParams: dto.PaginationParams{Page: 1, Size: 50}})
		if err != nil {
			t.Fatal(err)
		}
		return runs
	}
	// 先 @ 一次占掉一个名额，再回复两次：第二次回复超出
	mentionAs(t, author, postID, "@ai_one 你怎么看", ai1.User.ID)
	for i := range 2 {
		if _, svcerr := createComment(author, postID, aiComment, false); svcerr != nil {
			t.Fatalf("reply %d: %v", i, svcerr)
		}
	}
	runs := repliedRuns()
	if countStatus(runs, constant.AgentRunStatusQueued, "") != 1 || countStatus(runs, constant.AgentRunStatusSkipped, "reply_pair_limit") != 1 {
		t.Fatalf("reply pair limit: %+v", runs)
	}
	// 名额满了以后 @ 也不再安排
	mentionAs(t, author, postID, "@ai_one 再问一次", ai1.User.ID)
	if countStatus(mentionRunsOf(t, ai1.ID), constant.AgentRunStatusSkipped, "mention_pair_limit") != 1 {
		t.Fatalf("mention should share the pair quota: %+v", mentionRunsOf(t, ai1.ID))
	}
	// 管理员不受限
	if _, svcerr := createComment(admin, postID, aiComment, false); svcerr != nil {
		t.Fatal(svcerr)
	}
	if runs := repliedRuns(); countStatus(runs, constant.AgentRunStatusQueued, "") != 2 {
		t.Fatalf("admin reply should not be limited: %+v", runs)
	}
}

// 全站 AI 评论上限：多个 AI 同时评论时，检查与写入在同一把锁里，不会超出
func TestAgentGlobalCommentLimitConcurrent(t *testing.T) {
	admin, _, ai1, ai2, postID := setupAgentTest(t)
	if err := repo.KV.SetKV("ai_agents_comments_per_day", 1); err != nil {
		t.Fatal(err)
	}
	svc := NewAIAgentService()
	profile := ai1.Profile
	agents := []uint{ai1.ID, ai2.ID}
	for i := range 3 {
		a, svcerr := svc.Create(admin, &dto.CreateAIAgentReq{Username: fmt.Sprintf("ai_extra%d", i), Nickname: fmt.Sprintf("路人%d", i), Profile: &profile})
		if svcerr != nil {
			t.Fatal(svcerr)
		}
		agents = append(agents, a.ID)
	}
	ctxs := make([]context.Context, len(agents))
	for i, id := range agents {
		ctxs[i], _ = leaseCtx(t, id, constant.AgentRunKindBrowse)
	}
	var wg sync.WaitGroup
	var ok atomic.Int32
	contents := []string{"嵌入资源之后部署简单多了", "我更关心更新频率", "示例代码写得很清楚", "这个思路之前没想到", "收藏了慢慢看"}
	for i := range agents {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, svcerr := svc.AgentCreateComment(ctxs[i], constant.TargetTypePost, postID, 0, contents[i]); svcerr == nil {
				ok.Add(1)
			} else if !strings.HasPrefix(svcerr.Message, "agent_") {
				t.Errorf("unexpected error: %v", svcerr)
			}
		}()
	}
	wg.Wait()
	if n, _ := repo.AIAgent.CountAIComments(dayStart(time.Now())); ok.Load() != 1 || n != 1 {
		t.Fatalf("succeeded = %d, ai comments = %d, want 1", ok.Load(), n)
	}
}

// 后台 AI 用户列表的今日评论数与点赞数按用户分组批量查询，结果与逐个计数一致
func TestAIAgentListTodayCounts(t *testing.T) {
	admin, _, ai1, ai2, postID := setupAgentTest(t)
	svc := NewAIAgentService()
	ctx, _ := leaseCtx(t, ai1.ID, constant.AgentRunKindBrowse)
	if _, svcerr := svc.AgentCreateComment(ctx, constant.TargetTypePost, postID, 0, "写得很清楚，收藏了"); svcerr != nil {
		t.Fatal(svcerr)
	}
	if _, svcerr := svc.AgentSetLike(ctx, constant.TargetTypePost, postID, true); svcerr != nil {
		t.Fatal(svcerr)
	}
	list, _, svcerr := svc.List(admin, &dto.AdminListAIAgentsReq{PaginationParams: dto.PaginationParams{Page: 1, Size: 20}})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	got := map[uint][2]int64{}
	for _, a := range list {
		got[a.ID] = [2]int64{a.TodayComments, a.TodayLikes}
	}
	if got[ai1.ID] != [2]int64{1, 1} || got[ai2.ID] != [2]int64{0, 0} {
		t.Fatalf("today counts = %v", got)
	}
}
