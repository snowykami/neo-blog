package mcpserver

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 与人物蒸馏 skill 配套的流程：查找已有的同一个人 → 读取 → 按原用户名更新；只有管理员能拿到 ai_agents 权限范围
func TestAIUserTools(t *testing.T) {
	env := setupTest(t)
	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	if err := repo.GetDB().Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	// 编辑者不能创建带 ai_agents 权限范围的 Token
	if _, svcerr := service.NewAPITokenService().Create(env.authorCtx, &dto.CreateAPITokenReq{Name: "x", Scopes: []string{constant.ScopeAIAgentsRead}}); svcerr == nil {
		t.Fatal("editor should not get ai_agents scopes")
	}
	reader := tokenCtx(t, admin, constant.ScopeAIAgentsRead)
	writer := tokenCtx(t, admin, constant.ScopeAIAgentsRead, constant.ScopeAIAgentsWrite)
	postsOnly := tokenCtx(t, admin, constant.ScopePostsRead)

	_, _, err := findAIUsers(postsOnly, nil, findAIUsersInput{Names: []string{"x"}})
	wantErr(t, err, constant.ScopeAIAgentsRead)
	furina := aiUserFile{Username: "furina_fontaine", Nickname: "芙宁娜", Profile: map[string]any{
		"archetype": "退隐的枫丹大明星", "persona": "我是芙宁娜，Furina，曾经是枫丹的大明星", "tone": "浮夸又真诚",
	}}
	_, _, err = importAIUsers(reader, nil, importAIUsersInput{Agents: []aiUserFile{furina}})
	wantErr(t, err, constant.ScopeAIAgentsWrite)

	// 试运行不写入，正式导入后新建
	_, preview, err := importAIUsers(writer, nil, importAIUsersInput{Agents: []aiUserFile{furina}, DryRun: true})
	if err != nil || len(preview.Results) != 1 || preview.Results[0].Action != "create" {
		t.Fatalf("dry run import = %+v, %v", preview, err)
	}
	if _, found, _ := findAIUsers(reader, nil, findAIUsersInput{Names: []string{"furina_fontaine"}}); len(found.Matches) != 0 {
		t.Fatal("dry run should not create anything")
	}
	if _, out, err := importAIUsers(writer, nil, importAIUsersInput{Agents: []aiUserFile{furina}}); err != nil || out.Results[0].Action != "create" {
		t.Fatalf("import = %+v, %v", out, err)
	}

	// 换了用户名的蒸馏结果也能按昵称、人设里的名字找到；普通用户占用的用户名单独列出
	_, found, err := findAIUsers(reader, nil, findAIUsersInput{Names: []string{"芙宁娜", "furina", "author"}})
	if err != nil || len(found.Matches) != 1 || found.Matches[0].Username != "furina_fontaine" {
		t.Fatalf("find = %+v, %v", found, err)
	}
	if m := found.Matches[0]; !slices.Contains(m.MatchedBy, "nickname") || !slices.Contains(m.MatchedBy, "username_partial") || !slices.Contains(m.MatchedBy, "persona") {
		t.Fatalf("matched_by = %v", m.MatchedBy)
	}
	if !slices.Equal(found.TakenUsernames, []string{"author"}) {
		t.Fatalf("taken = %v", found.TakenUsernames)
	}
	if _, empty, _ := findAIUsers(reader, nil, findAIUsersInput{Names: []string{"不存在的人"}}); len(empty.Matches) != 0 {
		t.Fatalf("unexpected matches %+v", empty.Matches)
	}
	_, _, err = findAIUsers(reader, nil, findAIUsersInput{Names: []string{" "}})
	wantErr(t, err, "invalid_request_parameters")

	// 读取：与导入文件相同的格式，可以直接修改后再导入
	_, got, err := getAIUser(reader, nil, getAIUserInput{Username: "furina_fontaine"})
	if err != nil || got.Agent.Nickname != "芙宁娜" || got.Agent.Profile["tone"] != "浮夸又真诚" || got.Status != constant.AIAgentStatusActive || got.RecentComments == nil {
		t.Fatalf("get = %+v, %v", got, err)
	}
	_, _, err = getAIUser(reader, nil, getAIUserInput{Username: "author"})
	wantErr(t, err, "not found")

	// 按原用户名更新：性格档案被替换，账号资料（昵称）保持不变
	updated := got.Agent
	updated.Nickname = "改名"
	updated.Profile["tone"] = "随意、话少"
	if _, out, err := importAIUsers(writer, nil, importAIUsersInput{Agents: []aiUserFile{updated}}); err != nil || out.Results[0].Action != "update" {
		t.Fatalf("update = %+v, %v", out, err)
	}
	_, got, _ = getAIUser(reader, nil, getAIUserInput{Username: "furina_fontaine"})
	if got.Agent.Profile["tone"] != "随意、话少" || got.Agent.Nickname != "芙宁娜" {
		t.Fatalf("after update = %+v", got.Agent)
	}
	// 导入失败的项给出可读的原因
	if _, out, _ := importAIUsers(writer, nil, importAIUsersInput{Agents: []aiUserFile{{Username: "author"}}}); out.Results[0].Error == "" || out.Results[0].Action != "" {
		t.Fatalf("taken username = %+v", out.Results[0])
	}
}

// 试运行由后端 worker 执行：等不到结果时返回运行 ID，之后可以查询
func TestDryRunAIUser(t *testing.T) {
	env := setupTest(t)
	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	repo.GetDB().Create(admin)
	writer := tokenCtx(t, admin, constant.ScopeAIAgentsRead, constant.ScopeAIAgentsWrite)
	if _, _, err := importAIUsers(writer, nil, importAIUsersInput{Agents: []aiUserFile{{Username: "ai_one"}}}); err != nil {
		t.Fatal(err)
	}
	post := &model.Post{UserID: env.author.ID, PostBase: model.PostBase{Title: "p", Content: "<p>正文</p>"}}
	repo.GetDB().Create(post)

	wait := dryRunWait
	dryRunWait, dryRunInterval = 30*time.Millisecond, 10*time.Millisecond
	t.Cleanup(func() { dryRunWait, dryRunInterval = wait, 2*time.Second })

	_, _, err := dryRunAIUser(writer, nil, dryRunAIUserInput{Username: "ai_one"})
	wantErr(t, err, "exactly one")
	_, run, err := dryRunAIUser(writer, nil, dryRunAIUserInput{Username: "ai_one", PostID: post.ID})
	if err != nil || run.RunID == 0 || run.Status != constant.AgentRunStatusQueued || run.Note == "" {
		t.Fatalf("dry run = %+v, %v", run, err)
	}
	_, got, err := getAIUserRun(writer, nil, getAIUserRunInput{RunID: run.RunID})
	if err != nil || got.RunID != run.RunID {
		t.Fatalf("get run = %+v, %v", got, err)
	}
	_, _, err = dryRunAIUser(context.Background(), nil, dryRunAIUserInput{Username: "ai_one", PostID: post.ID})
	wantErr(t, err, "personal API tokens")
}
