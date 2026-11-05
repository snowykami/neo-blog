package service

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func resultCodes(results []dto.ImportAIAgentResult) []string {
	codes := make([]string, len(results))
	for i, r := range results {
		if r.Error != nil {
			codes[i] = r.Error.Code
		} else {
			codes[i] = r.Action
		}
	}
	return codes
}

func TestAIAgentExportImport(t *testing.T) {
	t.Setenv(constant.EnvKeyBaseUrl, "https://blog.test")
	admin, author, ai1, ai2, _ := setupAgentTest(t)
	svc := NewAIAgentService()
	if err := repo.User.UpdateUserColumns(ai1.User.ID, map[string]any{"avatar_url": "/api/v1/file/7", "preferred_color": "rose"}); err != nil {
		t.Fatalf("update user: %v", err)
	}

	// 只有管理员能导出、导入
	if _, svcerr := svc.Export(author, &dto.ExportAIAgentsReq{}); svcerr == nil {
		t.Fatal("non-admin export should be refused")
	}
	if _, svcerr := svc.Import(author, &dto.ImportAIAgentsReq{Agents: []dto.AIAgentFileItem{{Username: "x"}}}); svcerr == nil {
		t.Fatal("non-admin import should be refused")
	}
	if _, svcerr := svc.Import(admin, &dto.ImportAIAgentsReq{}); svcerr == nil || svcerr.Message != "invalid_ai_agent_count" {
		t.Fatalf("empty import should fail, got %v", svcerr)
	}

	// 导出全部：按创建顺序，站内头像补全为绝对地址
	exported, svcerr := svc.Export(admin, &dto.ExportAIAgentsReq{})
	if svcerr != nil || len(exported) != 2 {
		t.Fatalf("export = %+v, %v", exported, svcerr)
	}
	if got := exported[0]; got.Username != "ai_one" || got.AvatarUrl != "https://blog.test/api/v1/file/7" || got.PreferredColor != "rose" {
		t.Fatalf("exported ai1 = %+v", got)
	}
	single, svcerr := svc.Export(admin, &dto.ExportAIAgentsReq{ID: ai2.ID})
	if svcerr != nil || len(single) != 1 || single[0].Username != "ai_two" {
		t.Fatalf("export single = %+v, %v", single, svcerr)
	}
	// 导出勾选的：不存在的 ID 跳过，格式不对时报错
	picked, svcerr := svc.Export(admin, &dto.ExportAIAgentsReq{IDs: fmt.Sprintf("%d, 99999", ai2.ID)})
	if svcerr != nil || len(picked) != 1 || picked[0].Username != "ai_two" {
		t.Fatalf("export picked = %+v, %v", picked, svcerr)
	}
	if _, svcerr := svc.Export(admin, &dto.ExportAIAgentsReq{IDs: "1,x"}); svcerr == nil {
		t.Fatal("invalid ids should be refused")
	}

	roundTrip := exported[1]
	roundTrip.Username = "ai_two_copy"
	items := []dto.AIAgentFileItem{
		{Username: "distilled", Nickname: "蒸馏", Profile: json.RawMessage(`{"persona":"我是一个爱折腾的后端","activity":{"active_hours":"20-24"},"interests":["Go","猫"]}`)},
		roundTrip,
		{Username: "ai_one", Nickname: "改名", Tier: constant.AIAgentTierExpert, Profile: json.RawMessage(`{"tone":"新的语气","activity":{"daily_actions":4}}`)},
		{Username: "other"},
		{Username: "bad_tz", Profile: json.RawMessage(`{"activity":{"timezone":"Mars/Base"}}`)},
		{Username: "bad_type", Profile: json.RawMessage(`{"activity":{"daily_actions":"many"}}`)},
		{Username: "bad_color", PreferredColor: "nope"},
		{Username: "expert_one", Tier: constant.AIAgentTierExpert, Profile: json.RawMessage(`{"expertise":["数据库"]}`)},
	}
	want := []string{"create", "create", "update", "ai_agent_username_taken", "invalid_timezone", "invalid_ai_agent_profile", "invalid_preferred_color", "create"}

	// 试运行：给出每一项的操作，不写入
	before, _ := repo.AIAgent.CountBy("", "")
	preview, svcerr := svc.Import(admin, &dto.ImportAIAgentsReq{Agents: items, DryRun: true})
	if svcerr != nil || !reflect.DeepEqual(resultCodes(preview), want) {
		t.Fatalf("dry run = %v, %v, want %v", resultCodes(preview), svcerr, want)
	}
	after, _ := repo.AIAgent.CountBy("", "")
	ai1Now, _ := svc.Get(admin, ai1.ID)
	if after != before || preview[0].AgentID != 0 || preview[2].AgentID != ai1.ID || ai1Now.Profile.Tone != ai1.Profile.Tone {
		t.Fatalf("dry run must not write: before %d after %d, results %+v", before, after, preview)
	}

	// 逐个导入：成功的新建或更新，失败的返回错误码，互不影响
	results, svcerr := svc.Import(admin, &dto.ImportAIAgentsReq{Agents: items})
	if svcerr != nil || !reflect.DeepEqual(resultCodes(results), want) {
		t.Fatalf("import = %v, %v, want %v", resultCodes(results), svcerr, want)
	}
	for i, r := range results {
		if r.Index != i || (r.Error == nil) != (r.AgentID != 0) {
			t.Fatalf("result %d = %+v", i, r)
		}
	}

	// 新建：缺少的字段取该类型的默认值，嵌套对象逐字段合并，数组整体替换
	distilled, _ := svc.Get(admin, results[0].AgentID)
	defaults := DefaultAIAgentProfile(constant.AIAgentTierAmbient)
	p := distilled.Profile
	if p.Persona != "我是一个爱折腾的后端" || p.Activity.ActiveHours != "20-24" || !reflect.DeepEqual(p.Interests, []string{"Go", "猫"}) {
		t.Fatalf("imported fields lost: %+v", p)
	}
	if p.Activity.DailyActions != defaults.Activity.DailyActions || p.Behavior != defaults.Behavior || p.Limits != defaults.Limits || !reflect.DeepEqual(p.BlockedTopics, defaults.BlockedTopics) {
		t.Fatalf("missing fields should use defaults: %+v", p)
	}
	if distilled.User.Nickname != "蒸馏" || distilled.Tier != constant.AIAgentTierAmbient || distilled.Status != constant.AIAgentStatusActive {
		t.Fatalf("distilled = %+v", distilled)
	}
	user, _ := repo.User.GetUserByUsername("distilled")
	if !user.IsAI || user.Role != constant.RoleUser {
		t.Fatalf("imported user = %+v", user)
	}
	// 导出再导入得到相同的性格档案
	copied, _ := svc.Get(admin, results[1].AgentID)
	if !reflect.DeepEqual(copied.Profile, ai2.Profile) || copied.Tier != ai2.Tier {
		t.Fatalf("round trip profile = %+v, want %+v", copied.Profile, ai2.Profile)
	}
	// 更新已有的 AI 用户：类型与写到的字段更新，其余字段保持原值，账号资料不变
	updated, _ := svc.Get(admin, ai1.ID)
	if updated.Tier != constant.AIAgentTierExpert || updated.Profile.Tone != "新的语气" || updated.Profile.Activity.DailyActions != 4 {
		t.Fatalf("update not applied: %+v", updated)
	}
	if updated.Profile.Activity.ActiveHours != ai1.Profile.Activity.ActiveHours || updated.Profile.Limits != ai1.Profile.Limits || updated.User.Nickname != "小橘" {
		t.Fatalf("update should keep other fields and account: %+v", updated)
	}
	// 专业型取专业型的默认值
	expert, _ := svc.Get(admin, results[7].AgentID)
	if !expert.Profile.WebFetch.Enabled || expert.Profile.Behavior != DefaultAIAgentProfile(constant.AIAgentTierExpert).Behavior {
		t.Fatalf("expert defaults = %+v", expert.Profile)
	}
}
