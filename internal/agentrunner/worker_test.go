package agentrunner

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// setupWorkerTest 初始化数据库（SQLite）与进程内共享状态
func setupWorkerTest(t *testing.T) {
	t.Helper()
	sharedstate.UseMemory()
	interval := pollInterval
	pollInterval = 100 * time.Millisecond
	t.Cleanup(func() { pollInterval = interval })
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
}

// startWorkers 启动一组 worker（相当于一个实例），返回停止函数
func startWorkers(t *testing.T, workers int) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		workLoop(ctx, workers)
		close(done)
	}()
	return func() {
		cancel()
		<-done
	}
}

// waitRun 等待运行结束（完成或失败）
func waitRun(t *testing.T, runID uint) *model.AgentRun {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		got, _ := repo.AIAgent.GetRun(runID)
		if got.Status == constant.AgentRunStatusDone || got.Status == constant.AgentRunStatusFailed {
			return got
		}
		if time.Now().After(deadline) {
			t.Fatalf("run not finished: %+v", got)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// 端到端：后端进程内的 worker 领取任务、以 AI 用户身份读文章、调用（模拟的）模型，
// 再由执行器点赞和评论，最后回报结果并写入记忆
func TestAIAgentWorkerEndToEnd(t *testing.T) {
	setupWorkerTest(t)

	// 模拟 OpenAI 兼容的模型：检查后端替换了模型与密钥，返回操作列表
	var mu sync.Mutex
	var seenModel, seenAuth, seenPrompt string
	var postID, replyTarget uint
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Model    string `json:"model"`
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.Unmarshal(body, &req)
		mu.Lock()
		seenModel, seenAuth = req.Model, r.Header.Get("Authorization")
		if len(req.Messages) > 1 {
			seenPrompt = req.Messages[1].Content
		}
		mu.Unlock()
		content := fmt.Sprintf(`{"actions":[{"type":"like","target":"post:%d"},{"type":"comment","target":"post:%d","content":"离线库这个思路很实用，embed 打包也省事"},{"type":"comment","target":"post:%d","content":"重复的一条"}],"reason":"内容和兴趣相关","memory_note":"作者在做离线 IP 库"}`, postID, postID, postID)
		// 专业型：第一轮先调用只读工具读评论，拿到工具结果后回复其中的 AI 评论
		if strings.Contains(string(body), `"tools"`) && !strings.Contains(string(body), `"role":"tool"`) {
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{
				"role": "assistant", "content": "",
				"tool_calls": []any{map[string]any{"id": "call_1", "type": "function", "function": map[string]any{"name": "list_comments", "arguments": fmt.Sprintf(`{"target":"post:%d"}`, postID)}}},
			}}}})
			return
		}
		if strings.Contains(string(body), `"role":"tool"`) {
			mu.Lock()
			target := replyTarget
			mu.Unlock()
			content = fmt.Sprintf(`{"actions":[{"type":"reply","target":"comment:%d","content":"补充一点：数据文件建议每周自动更新"}],"reason":"补充技术细节","memory_note":""}`, target)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}},
			"usage":   map[string]any{"prompt_tokens": 1200, "completion_tokens": 80, "prompt_tokens_details": map[string]any{"cached_tokens": 1000}},
		})
	}))
	defer llm.Close()
	for k, v := range map[string]any{
		"ai_agents_enabled": true, "ai_api_base_url": llm.URL, "ai_api_key": "sk-test", "ai_model": "site-model", "ai_agent_model_ambient": "ambient-model",
	} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatal(err)
		}
	}

	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	author := &model.User{Username: "author", Email: "author@test.local", Role: constant.RoleEditor}
	repo.GetDB().Create(admin)
	repo.GetDB().Create(author)
	adminCtx := context.WithValue(context.Background(), "user_id", admin.ID)
	isPrivate := true // 先以私密创建，避免发布事件生成额外任务
	id, svcerr := service.NewPostService().CreatePost(context.WithValue(context.Background(), "user_id", author.ID), &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{Title: "用 Go 写一个离线 IP 归属地查询", Content: "<p>正文：ip2region 的用法</p>"},
		IsPrivate:   &isPrivate,
	})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	repo.GetDB().Model(&model.Post{}).Where("id = ?", id).Update("is_private", false)
	postID = id
	profile := service.DefaultAIAgentProfile(constant.AIAgentTierAmbient)
	profile.SelfEdit.Enabled = false
	agent, svcerr := service.NewAIAgentService().Create(adminCtx, &dto.CreateAIAgentReq{Username: "ai_orange", Nickname: "小橘", Profile: &profile})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	run := &model.AgentRun{AgentID: agent.ID, Kind: constant.AgentRunKindBrowse, Trigger: constant.AgentTriggerBrowse,
		Feed: fmt.Sprintf("[%d]", postID), Status: constant.AgentRunStatusQueued, ScheduledAt: time.Now()}
	if err := repo.AIAgent.CreateRun(run); err != nil {
		t.Fatal(err)
	}

	stop := startWorkers(t, 1)
	defer stop()
	got := waitRun(t, run.ID)
	if got.Status != constant.AgentRunStatusDone {
		t.Fatalf("run failed: %s", got.Error)
	}
	mu.Lock()
	if seenModel != "ambient-model" || seenAuth != "Bearer sk-test" || !strings.Contains(seenPrompt, "<material") || !strings.Contains(seenPrompt, "ip2region") {
		t.Fatalf("llm saw model=%q auth=%q prompt=%q", seenModel, seenAuth, seenPrompt)
	}
	mu.Unlock()
	if got.PromptTokens != 1200 || got.CachedTokens != 1000 || got.CompletionTokens != 80 || got.LLMCalls != 1 || got.Model != "ambient-model" {
		t.Fatalf("usage = %+v", got)
	}
	var actions []dto.AgentActionDto
	_ = json.Unmarshal([]byte(got.Actions), &actions)
	if len(actions) != 3 || actions[0].Result != "ok" || actions[1].Result != "ok" || actions[1].CommentID == 0 || actions[2].Result != "skipped" {
		t.Fatalf("actions = %+v", actions)
	}
	comment, err := repo.Comment.GetComment(actions[1].CommentID)
	if err != nil || comment.UserID != agent.User.ID || !strings.Contains(comment.Content, "离线库") {
		t.Fatalf("comment = %+v %v", comment, err)
	}
	liked, _ := repo.Like.LikedTargetIDs(agent.User.ID, constant.TargetTypePost, []uint{postID})
	if !liked[postID] {
		t.Fatal("post should be liked by the ai user")
	}
	// 记忆在运行标记完成后写入
	var memories []dto.AgentMemoryDto
	for deadline := time.Now().Add(5 * time.Second); len(memories) == 0 && time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		memories, _, _ = service.NewAIAgentService().ListMemories(adminCtx, &dto.ListAgentMemoriesReq{ID: agent.ID, PaginationParams: dto.PaginationParams{Page: 1, Size: 10}})
	}
	if len(memories) == 0 || !strings.Contains(memories[0].Content, "离线 IP 库") {
		t.Fatalf("memories = %+v", memories)
	}

	// 专业型：多步阅读（只读工具）后回复上一个 AI 的评论（AI 之间互动，深度 2）
	expertProfile := service.DefaultAIAgentProfile(constant.AIAgentTierExpert)
	expertProfile.SelfEdit.Enabled = false
	expertProfile.WebFetch.Enabled = false
	expert, svcerr := service.NewAIAgentService().Create(adminCtx, &dto.CreateAIAgentReq{Username: "ai_lint", Nickname: "Lint", Tier: constant.AIAgentTierExpert, Profile: &expertProfile})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	mu.Lock()
	replyTarget = actions[1].CommentID
	mu.Unlock()
	run2 := &model.AgentRun{AgentID: expert.ID, Kind: constant.AgentRunKindBrowse, Trigger: constant.AgentTriggerBrowse,
		Feed: fmt.Sprintf("[%d]", postID), Status: constant.AgentRunStatusQueued, ScheduledAt: time.Now()}
	if err := repo.AIAgent.CreateRun(run2); err != nil {
		t.Fatal(err)
	}
	// 直接写库的任务没有入队通知，由 worker 的定期检查领取
	got = waitRun(t, run2.ID)
	if got.Status != constant.AgentRunStatusDone || got.LLMCalls != 2 || !strings.Contains(got.Trace, "tool:list_comments") {
		t.Fatalf("expert run = %+v", got)
	}
	_ = json.Unmarshal([]byte(got.Actions), &actions)
	if len(actions) != 1 || actions[0].Result != "ok" || actions[0].CommentID == 0 {
		t.Fatalf("expert actions = %+v", actions)
	}
	reply, _ := repo.Comment.GetComment(actions[0].CommentID)
	if reply.ReplyID != replyTarget || reply.UserID != expert.User.ID {
		t.Fatalf("reply = %+v", reply)
	}
}

// 多副本：两个实例的 worker 同时运行，任务都能完成且每个只执行一次
func TestAIAgentWorkersAcrossInstances(t *testing.T) {
	setupWorkerTest(t)
	var calls atomic.Int32
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		// 模型稍慢一些，让两个实例都有机会领到任务
		time.Sleep(200 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": `{"actions":[],"reason":"没什么想说的","memory_note":""}`}}},
		})
	}))
	defer llm.Close()
	for k, v := range map[string]any{"ai_agents_enabled": true, "ai_api_base_url": llm.URL, "ai_api_key": "sk-test", "ai_model": "site-model"} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatal(err)
		}
	}
	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	repo.GetDB().Create(admin)
	adminCtx := context.WithValue(context.Background(), "user_id", admin.ID)
	post := &model.Post{UserID: admin.ID, PostBase: model.PostBase{Title: "多副本", Content: "<p>正文</p>"}}
	repo.GetDB().Create(post)

	runIDs := make([]uint, 0, 4)
	for i := range 4 {
		profile := service.DefaultAIAgentProfile(constant.AIAgentTierAmbient)
		profile.SelfEdit.Enabled = false
		agent, svcerr := service.NewAIAgentService().Create(adminCtx, &dto.CreateAIAgentReq{Username: fmt.Sprintf("ai_%d", i), Nickname: fmt.Sprintf("AI %d", i), Profile: &profile})
		if svcerr != nil {
			t.Fatal(svcerr)
		}
		run := &model.AgentRun{AgentID: agent.ID, Kind: constant.AgentRunKindBrowse, Trigger: constant.AgentTriggerBrowse,
			Feed: fmt.Sprintf("[%d]", post.ID), Status: constant.AgentRunStatusQueued, ScheduledAt: time.Now()}
		if err := repo.AIAgent.CreateRun(run); err != nil {
			t.Fatal(err)
		}
		runIDs = append(runIDs, run.ID)
	}

	stopA := startWorkers(t, 1)
	stopB := startWorkers(t, 1)
	for _, id := range runIDs {
		if got := waitRun(t, id); got.Status != constant.AgentRunStatusDone || got.Attempts != 1 || got.LLMCalls != 1 {
			t.Fatalf("run %d = %+v", id, got)
		}
	}
	stopA()
	stopB()
	if n := calls.Load(); n != int32(len(runIDs)) {
		t.Fatalf("llm called %d times for %d runs", n, len(runIDs))
	}
}

// 评论带 AI 腔时让模型按设定重写一次，发表的是重写后的内容，运行轨迹里留下 humanize 记录
func TestAIAgentHumanizeRewrite(t *testing.T) {
	setupWorkerTest(t)
	var mu sync.Mutex
	var postID uint
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		target := postID
		mu.Unlock()
		content := fmt.Sprintf(`{"actions":[{"type":"comment","target":"post:%d","content":"感谢分享！这篇文章写得非常好——学到了很多。"}],"reason":"喜欢","memory_note":""}`, target)
		if strings.Contains(string(body), "AI 味太重") {
			content = fmt.Sprintf(`{"actions":[{"type":"comment","target":"post:%d","content":"ip2region 我也在用，更新数据挺麻烦的"}],"reason":"喜欢","memory_note":""}`, target)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}},
			"usage":   map[string]any{"prompt_tokens": 100, "completion_tokens": 20},
		})
	}))
	defer llm.Close()
	for k, v := range map[string]any{"ai_agents_enabled": true, "ai_api_base_url": llm.URL, "ai_api_key": "sk-test", "ai_model": "m"} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatal(err)
		}
	}
	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	author := &model.User{Username: "author", Email: "author@test.local", Role: constant.RoleEditor}
	repo.GetDB().Create(admin)
	repo.GetDB().Create(author)
	isPrivate := true
	id, svcerr := service.NewPostService().CreatePost(context.WithValue(context.Background(), "user_id", author.ID), &dto.CreateOrUpdatePostReq{
		PostBaseDto: dto.PostBaseDto{Title: "用 Go 写一个离线 IP 归属地查询", Content: "<p>正文：ip2region 的用法</p>"},
		IsPrivate:   &isPrivate,
	})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	repo.GetDB().Model(&model.Post{}).Where("id = ?", id).Update("is_private", false)
	mu.Lock()
	postID = id
	mu.Unlock()
	profile := service.DefaultAIAgentProfile(constant.AIAgentTierAmbient)
	profile.SelfEdit.Enabled = false
	agent, svcerr := service.NewAIAgentService().Create(context.WithValue(context.Background(), "user_id", admin.ID), &dto.CreateAIAgentReq{Username: "ai_orange", Nickname: "小橘", Profile: &profile})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	run := &model.AgentRun{AgentID: agent.ID, Kind: constant.AgentRunKindBrowse, Trigger: constant.AgentTriggerBrowse,
		Feed: fmt.Sprintf("[%d]", id), Status: constant.AgentRunStatusQueued, ScheduledAt: time.Now()}
	if err := repo.AIAgent.CreateRun(run); err != nil {
		t.Fatal(err)
	}
	stop := startWorkers(t, 1)
	defer stop()
	got := waitRun(t, run.ID)
	if got.Status != constant.AgentRunStatusDone || got.LLMCalls != 2 || !strings.Contains(got.Trace, "humanize") {
		t.Fatalf("run = %+v", got)
	}
	var actions []dto.AgentActionDto
	_ = json.Unmarshal([]byte(got.Actions), &actions)
	if len(actions) != 1 || actions[0].Result != "ok" || actions[0].CommentID == 0 {
		t.Fatalf("actions = %+v", actions)
	}
	comment, err := repo.Comment.GetComment(actions[0].CommentID)
	if err != nil || comment.Content != "ip2region 我也在用，更新数据挺麻烦的" {
		t.Fatalf("comment = %+v %v", comment, err)
	}
}
