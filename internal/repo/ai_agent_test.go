package repo

import (
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// AI 用户的全部查询在 SQLite 与 Postgres 上都能执行并得到一致结果
func TestAIAgentQueries(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		must := func(err error) {
			t.Helper()
			if err != nil {
				t.Fatal(err)
			}
		}
		now := time.Now()
		human := &model.User{Username: "human", Email: "h@test.local"}
		aiUser := &model.User{Username: "ai_a", Email: "a@ai.invalid", IsAI: true}
		aiUser2 := &model.User{Username: "ai_b", Email: "b@ai.invalid", IsAI: true}
		must(db.Create(human).Error)
		group := &model.AIAgentGroup{Name: "g", Status: "done"}
		must(AIAgent.CreateGroup(group))
		agent := &model.AIAgent{Tier: constant.AIAgentTierAmbient, Status: constant.AIAgentStatusActive, Profile: "{}", GroupID: &group.ID}
		must(AIAgent.CreateWithUser(aiUser, agent))
		agent2 := &model.AIAgent{Tier: constant.AIAgentTierExpert, Status: constant.AIAgentStatusPaused, Profile: "{}"}
		must(AIAgent.CreateWithUser(aiUser2, agent2))

		post := &model.Post{UserID: human.ID, PostBase: model.PostBase{Title: "p", Content: "<p>x</p>"}}
		must(db.Create(post).Error)
		old := &model.Post{UserID: human.ID, PostBase: model.PostBase{Title: "old", Content: "<p>y</p>"}}
		must(db.Create(old).Error)
		must(db.Model(old).Update("created_at", now.AddDate(0, 0, -100)).Error)
		root := &model.Comment{UserID: human.ID, TargetType: "post", TargetID: post.ID, Content: "root"}
		must(db.Create(root).Error)
		r1 := &model.Comment{UserID: aiUser.ID, TargetType: "post", TargetID: post.ID, Content: "r1", ReplyID: root.ID, RootID: root.ID, Depth: 1}
		must(db.Create(r1).Error)
		r2 := &model.Comment{UserID: aiUser2.ID, TargetType: "post", TargetID: post.ID, Content: "r2", ReplyID: r1.ID, RootID: root.ID, Depth: 2}
		must(db.Create(r2).Error)
		must(db.Create(&model.Like{UserID: aiUser.ID, TargetType: "post", TargetID: post.ID}).Error)

		// AI 用户
		agents, total, err := AIAgent.List(&dto.AdminListAIAgentsReq{Query: "ai_", PaginationParams: dto.PaginationParams{Page: 1, Size: 10}})
		must(err)
		if total != 2 || len(agents) != 2 || agents[0].User.ID == 0 {
			t.Fatalf("list = %d %+v", total, agents)
		}
		active, err := AIAgent.ListActive()
		must(err)
		if len(active) != 1 || active[0].ID != agent.ID {
			t.Fatalf("active = %+v", active)
		}
		counts, err := AIAgent.GroupCounts()
		must(err)
		if counts[group.ID] != [2]int64{1, 1} {
			t.Fatalf("group counts = %v", counts)
		}

		// 运行记录
		past := now.Add(-time.Minute)
		expired := now.Add(-time.Second)
		runs := []model.AgentRun{
			{AgentID: agent.ID, Kind: "browse", Trigger: "browse", Status: constant.AgentRunStatusQueued, ScheduledAt: past, Feed: "[1]"},
			{AgentID: agent2.ID, Kind: "event", Trigger: "post.published", TargetType: "post", TargetID: post.ID, Status: constant.AgentRunStatusLeased, ScheduledAt: past, LeaseUntil: &expired, Attempts: 1},
			{AgentID: agent.ID, Kind: "browse", Trigger: "browse", Status: constant.AgentRunStatusDone, ScheduledAt: past, Effects: `[{"type":"comment","comment_id":1}]`, PromptTokens: 100, CompletionTokens: 10},
		}
		must(AIAgent.CreateRuns(runs))
		due, err := AIAgent.DueRuns(now, 10)
		must(err)
		if len(due) != 1 {
			t.Fatalf("due = %+v", due)
		}
		must(AIAgent.RequeueExpired(now, 3))
		if r, _ := AIAgent.GetRun(runs[1].ID); r.Status != constant.AgentRunStatusQueued {
			t.Fatalf("expired lease not requeued: %+v", r)
		}
		ok, err := AIAgent.UpdateRunIf(runs[0].ID, constant.AgentRunStatusQueued, map[string]any{"status": constant.AgentRunStatusLeased, "lease_until": now.Add(time.Minute)})
		must(err)
		if !ok {
			t.Fatal("claim failed")
		}
		if again, _ := AIAgent.UpdateRunIf(runs[0].ID, constant.AgentRunStatusQueued, map[string]any{"status": constant.AgentRunStatusLeased}); again {
			t.Fatal("double claim")
		}
		leased, err := AIAgent.LeasedAgentIDs(now)
		must(err)
		pending, err := AIAgent.PendingAgentIDs()
		must(err)
		if !leased[agent.ID] || !pending[agent2.ID] {
			t.Fatalf("leased=%v pending=%v", leased, pending)
		}
		if exists, _ := AIAgent.TriggerExists("post.published", "post", post.ID); !exists {
			t.Fatal("trigger exists")
		}
		list, n, err := AIAgent.ListRuns(&dto.ListAgentRunsReq{Action: "comment", Trigger: "browse", PaginationParams: dto.PaginationParams{Page: 1, Size: 10}})
		must(err)
		if n != 1 || len(list) != 1 {
			t.Fatalf("runs by action = %d", n)
		}
		must(AIAgent.AddRunUsage(runs[2].ID, "m", 50, 20, 5))
		sum, err := AIAgent.SumTokens(now.Add(-time.Hour))
		must(err)
		byAgent, err := AIAgent.SumTokensByAgent([]uint{agent.ID}, now.Add(-time.Hour))
		must(err)
		if sum != 165 || byAgent[agent.ID] != 165 {
			t.Fatalf("tokens = %d %v", sum, byAgent)
		}

		// 计数
		since := now.Add(-time.Hour)
		if n, _ := AIAgent.CountAIComments(since); n != 2 {
			t.Fatalf("ai comments = %d", n)
		}
		if n, _ := AIAgent.CountAILikes(since); n != 1 {
			t.Fatalf("ai likes = %d", n)
		}
		ai, humanCount, err := AIAgent.CountTargetComments("post", post.ID)
		must(err)
		// r1 是 AI 回复真人，单独计数，不算进单篇的 AI 评论数
		if ai != 1 || humanCount != 1 {
			t.Fatalf("target comments = %d %d", ai, humanCount)
		}
		if n, _ := AIAgent.CountAIRepliesTo(root.ID); n != 1 {
			t.Fatalf("ai replies to root = %d", n)
		}
		if n, _ := AIAgent.CountUserRootCommentsOnTarget(aiUser.ID, "post", post.ID); n != 0 {
			t.Fatalf("root comments of ai = %d", n)
		}
		if n, _ := AIAgent.CountPairReplies(aiUser2.ID, aiUser.ID, root.ID, since); n != 1 {
			t.Fatalf("pair replies = %d", n)
		}
		commented, liked, err := AIAgent.UserPostInteractions(aiUser.ID, []uint{post.ID, old.ID})
		must(err)
		if !commented[post.ID] || !liked[post.ID] || commented[old.ID] {
			t.Fatalf("interactions = %v %v", commented, liked)
		}
		if last, _ := AIAgent.LastCommentAt(aiUser.ID); last == nil {
			t.Fatal("last comment")
		}
		if contents, _ := AIAgent.RecentTargetComments("post", post.ID, 10); len(contents) != 3 {
			t.Fatalf("recent comments = %v", contents)
		}

		// 推荐流
		recent, err := AIAgent.RecentPublicPosts(now.AddDate(0, 0, -14), 10)
		must(err)
		hot, err := AIAgent.HotPublicPosts(10)
		must(err)
		olds, err := AIAgent.OldPublicPosts(now.AddDate(0, 0, -60), 10)
		must(err)
		if len(recent) != 1 || len(hot) != 2 || len(olds) != 1 || olds[0].ID != old.ID {
			t.Fatalf("feed = %d %d %d", len(recent), len(hot), len(olds))
		}

		// 记忆与关系
		expiredAt := now.Add(-time.Hour)
		for i := 0; i < 4; i++ {
			must(AIAgent.CreateMemory(&model.AgentMemory{AgentID: agent.ID, Kind: constant.AgentMemoryKindEpisode, Content: "m", SubjectUserID: &human.ID}))
		}
		must(AIAgent.CreateMemory(&model.AgentMemory{AgentID: agent.ID, Kind: constant.AgentMemoryKindEpisode, Content: "old", ExpiresAt: &expiredAt}))
		toConsolidate, err := AIAgent.AgentsToConsolidate(now, 10)
		must(err)
		if len(toConsolidate) != 1 || toConsolidate[0].ID != agent.ID {
			t.Fatalf("to consolidate = %+v", toConsolidate)
		}
		must(AIAgent.PruneMemories(agent.ID, now, 2))
		memories, total, err := AIAgent.ListMemories(&dto.ListAgentMemoriesReq{ID: agent.ID, PaginationParams: dto.PaginationParams{Page: 1, Size: 10}})
		must(err)
		if total != 2 || len(memories) != 2 {
			t.Fatalf("memories after prune = %d", total)
		}
		must(AIAgent.SaveRelation(&model.AgentRelation{AgentID: agent.ID, UserID: human.ID, Score: 1, ScoreAt: now, Familiarity: 0.63}))
		rels, err := AIAgent.RelationsFor(agent.ID, []uint{human.ID}, 3)
		must(err)
		if len(rels) != 1 {
			t.Fatalf("relations = %+v", rels)
		}

		// 删除用户时清理他人对其的记忆与关系（用没有评论的用户，DeleteUser 在 Postgres 上删除有评论的用户另有外键问题）
		quiet := &model.User{Username: "quiet", Email: "q@test.local"}
		must(db.Create(quiet).Error)
		must(AIAgent.SaveRelation(&model.AgentRelation{AgentID: agent.ID, UserID: quiet.ID, ScoreAt: now}))
		must(AIAgent.CreateMemory(&model.AgentMemory{AgentID: agent.ID, Kind: constant.AgentMemoryKindEpisode, Content: "q", SubjectUserID: &quiet.ID}))
		must(User.DeleteUser(quiet.ID, human.ID))
		if rels, _ := AIAgent.RelationsFor(agent.ID, []uint{quiet.ID}, 0); len(rels) != 0 {
			t.Fatal("relations about deleted user should be removed")
		}
		if ms, _, _ := AIAgent.ListMemories(&dto.ListAgentMemoriesReq{ID: agent.ID, SubjectUserID: quiet.ID, PaginationParams: dto.PaginationParams{Page: 1, Size: 10}}); len(ms) != 0 {
			t.Fatal("memories about deleted user should be removed")
		}
		must(AIAgent.Delete(agent2))
		if n, _ := AIAgent.CountBy("", ""); n != 1 {
			t.Fatalf("agents after delete = %d", n)
		}
	})
}
