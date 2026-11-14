package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 人设工厂：按「原型 × 占比」批量生成 AI 用户，保证群体多样性而不是千人一面

const (
	groupMaxCount     = 2000
	groupPreviewMax   = 10
	groupBatchSize    = 10
	groupBatchRetries = 3
	groupStatusGen    = "generating"
	groupStatusDone   = "done"
	groupStatusFailed = "failed"
)

// 作息模板：生成时随机分配，让不同 AI 在不同时间出现
var activeHourPresets = []string{"7-9,12-13,21-24", "9-12,14-18", "12-14,20-24", "19-24,0-2", "8-11,20-23", "10-12,15-17,21-23", "22-2"}

const personaSystemPrompt = `你在为一个博客社区生成虚拟社区成员（AI 用户）的人设。这些成员会在博客上浏览文章、点赞和留言。
请严格按要求输出 JSON 数组（不要输出其他内容），数组中每一项对应一个请求的槽位，顺序一致，并按请求中的 language 语言撰写：
[{"nickname": "像真实网友的昵称，不要带 AI 字样，不要重复（中文 2~12 字，外文简洁自然，≤20 字符）",
  "persona": "第一人称，身份、爱好、上网习惯、说话方式（中文 60~150 字，英文约 40~100 词）；用 language 指定的语言写，若设定还会其他语言（如英语）也可自然写明；不要冒充具体的真实人物，不要声称医生律师等需要资质的职业；禁止文艺鸡汤与对称模板句（如“白天写代码晚上看星星”“热爱生活与分享”“永远保持好奇心”），用具体日常状态代替空泛标签",
  "interests": ["3~6 个兴趣，尽量从 interest_pool 中选，也可以补充相近的（保留便于与文章匹配的话题词）"],
  "tone": "≤20 字（或简短一两句）的语气描述，用 language 指定的语言写",
  "style_samples": ["2~3 条这个人可能发的短评论，用 language 指定的语言写，每条 ≤40 字（英文约 ≤25 词）；必须像真实评论区随手敲的口语短句，少用工整排比和句末句号，不带感谢分享/写得真好/Great post/Thanks for sharing 等客套开场白"]}]
要求：同一批人之间的昵称、语气、兴趣组合要明显不同；避开黑名单话题。`

type personaSlot struct {
	Archetype   string `json:"archetype"`
	Description string `json:"description"`
}

// generatePersonas 调用模型生成一批人设
func generatePersonas(ctx context.Context, slots []personaSlot, tpl dto.AIAgentGroupTemplate) ([]dto.AIAgentPreview, error) {
	aiCfg := tools.GetAIConfig()
	if !aiCfg.Configured() {
		return nil, fmt.Errorf("ai not configured")
	}
	modelName := aiCfg.Model
	if cfg := tools.GetAIAgentConfig(); cfg.ModelAmbient != "" {
		modelName = cfg.ModelAmbient
	}
	user := mustJSON(map[string]any{
		"slots":          slots,
		"interest_pool":  tpl.Interests,
		"blocked_topics": tpl.BlockedTopics,
		"language":       utils.Ternary(tpl.Language != "", tpl.Language, "zh"),
	})
	callCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	// 与 worker 的调用共用全站预算；人设生成不属于任何 AI 用户，用量记为「后台任务」
	raw, err := backgroundAgentChat(callCtx, model.AgentRun{Trigger: constant.AgentTriggerGroupGenerate},
		tools.AIConfig{BaseURL: aiCfg.BaseURL, APIKey: aiCfg.APIKey, Model: modelName}, personaSystemPrompt, user, 0.9, "low")
	if err != nil {
		return nil, err
	}
	var items []dto.AIAgentPreview
	if err := json.Unmarshal([]byte(extractJSON(raw)), &items); err != nil {
		return nil, fmt.Errorf("parse personas: %w", err)
	}
	result := make([]dto.AIAgentPreview, 0, len(slots))
	for i, it := range items {
		if i >= len(slots) {
			break
		}
		it.Nickname = clipRunes(it.Nickname, nicknameMaxLen)
		it.Persona = clipRunes(it.Persona, 400)
		it.Tone = clipRunes(it.Tone, 40)
		it.Interests = cleanList(it.Interests, 8, 20)
		it.StyleSamples = cleanList(it.StyleSamples, 3, 60)
		it.Archetype = slots[i].Archetype
		if it.Nickname == "" || it.Persona == "" {
			continue
		}
		result = append(result, it)
	}
	return result, nil
}

// allocateSlots 按占比把 count 个名额分给各原型（最大余数法）
func allocateSlots(archetypes []dto.AIAgentArchetype, count int) []dto.AIAgentArchetype {
	total := 0.0
	for _, a := range archetypes {
		total += math.Max(a.Ratio, 0)
	}
	if total == 0 {
		total = float64(len(archetypes))
		for i := range archetypes {
			archetypes[i].Ratio = 1
		}
	}
	type share struct {
		idx  int
		n    int
		frac float64
	}
	shares := make([]share, len(archetypes))
	assigned := 0
	for i, a := range archetypes {
		exact := float64(count) * math.Max(a.Ratio, 0) / total
		shares[i] = share{i, int(exact), exact - math.Floor(exact)}
		assigned += int(exact)
	}
	for assigned < count {
		best := 0
		for i := range shares {
			if shares[i].frac > shares[best].frac {
				best = i
			}
		}
		shares[best].n++
		shares[best].frac = -1
		assigned++
	}
	slots := make([]dto.AIAgentArchetype, 0, count)
	for _, sh := range shares {
		for j := 0; j < sh.n; j++ {
			slots = append(slots, archetypes[sh.idx])
		}
	}
	rand.Shuffle(len(slots), func(i, j int) { slots[i], slots[j] = slots[j], slots[i] })
	return slots
}

func normalizeGroupTemplate(tpl *dto.AIAgentGroupTemplate) *errs.ServiceError {
	if tpl.Tier == "" {
		tpl.Tier = constant.AIAgentTierAmbient
	}
	if !isValidAgentTier(tpl.Tier) {
		return errs.NewBadRequest("invalid_ai_agent_tier")
	}
	if len(tpl.Archetypes) == 0 || len(tpl.Archetypes) > 20 {
		return errs.NewBadRequest("invalid_archetypes")
	}
	for i := range tpl.Archetypes {
		a := &tpl.Archetypes[i]
		a.Name = clipRunes(a.Name, 30)
		a.Description = clipRunes(a.Description, 200)
		if a.Name == "" {
			return errs.NewBadRequest("invalid_archetypes")
		}
		a.DailyActionsMin = math.Max(0, math.Min(48, a.DailyActionsMin))
		a.DailyActionsMax = math.Max(a.DailyActionsMin, math.Min(48, a.DailyActionsMax))
		a.Comment = clamp01(a.Comment)
	}
	tpl.Interests = cleanList(tpl.Interests, 60, 20)
	tpl.BlockedTopics = cleanList(tpl.BlockedTopics, 30, 30)
	tpl.AvatarStyle = strings.Trim(clipRunes(tpl.AvatarStyle, 30), "/")
	lang, ok := NormalizeAgentLanguage(tpl.Language)
	if !ok {
		return errs.NewBadRequest("invalid_language")
	}
	tpl.Language = lang
	return nil
}

// profileFromPersona 由生成的人设与原型参数组成性格档案
func profileFromPersona(p dto.AIAgentPreview, arch dto.AIAgentArchetype, tpl dto.AIAgentGroupTemplate) (dto.AIAgentProfile, *errs.ServiceError) {
	profile := DefaultAIAgentProfile(tpl.Tier)
	profile.Archetype = arch.Name
	profile.Language = utils.Ternary(tpl.Language != "", tpl.Language, "zh")
	profile.Persona = p.Persona
	profile.Interests = p.Interests
	profile.Tone = p.Tone
	profile.StyleSamples = p.StyleSamples
	if len(tpl.BlockedTopics) > 0 {
		profile.BlockedTopics = tpl.BlockedTopics
	}
	profile.Activity.DailyActions = math.Round(p.DailyActions*10) / 10
	profile.Activity.ActiveHours = activeHourPresets[rand.IntN(len(activeHourPresets))]
	profile.Behavior.Comment = arch.Comment
	profile.Behavior.Like = (1 - arch.Comment) * 0.6
	profile.Behavior.Lurk = math.Max(0, 1-arch.Comment-profile.Behavior.Like)
	return normalizeAgentProfile(profile)
}

// randomAIUsername ai_ 前缀加随机串
func randomAIUsername() string {
	return "ai_" + strings.ToLower(utils.Strings.GenerateRandomString(8))
}

// GenerateGroup 人设工厂：preview 时只返回预览，否则创建群体并在后台分批生成
func (s *AIAgentService) GenerateGroup(ctx context.Context, req *dto.GenerateAIAgentGroupReq) (*dto.GenerateAIAgentGroupResp, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	if svcerr := normalizeGroupTemplate(&req.Template); svcerr != nil {
		return nil, svcerr
	}
	if !tools.GetAIConfig().Configured() {
		return nil, errs.NewUnavailable("ai_not_configured")
	}
	if req.Preview {
		count := clampInt(req.Count, 1, groupPreviewMax)
		slots := allocateSlots(req.Template.Archetypes, count)
		personas, err := s.generateBatch(ctx, slots, req.Template)
		if err != nil {
			return nil, errs.NewUnavailable("persona_generation_failed").WithDetail(err.Error())
		}
		return &dto.GenerateAIAgentGroupResp{Preview: personas}, nil
	}
	name := clipRunes(req.Name, 64)
	if name == "" {
		return nil, errs.NewBadRequest("invalid_name")
	}
	if req.Count < 1 || req.Count > groupMaxCount {
		return nil, errs.NewBadRequest("invalid_count")
	}
	group := &model.AIAgentGroup{Name: name, Template: mustJSON(req.Template), Status: groupStatusGen, Total: req.Count}
	if err := repo.AIAgent.CreateGroup(group); err != nil {
		return nil, errs.Internal("failed_to_create_target", err).WithResource("ai_agent_group")
	}
	// 拿不到任务令牌（共享状态出错）时群体仍是「生成中」，由 job_recovery 接手
	s.startGroupGeneration(group.ID)
	counts := map[uint][2]int64{}
	d := s.groupDto(group, counts)
	return &dto.GenerateAIAgentGroupResp{Group: &d}, nil
}

// 群体生成的任务令牌：生成期间由执行的实例持有并自动续期；实例退出（滚动更新、崩溃）后最多 groupLeaseTTL 过期，
// 由 job_recovery 的 ResumeAIAgentGroups 在任意实例上接着生成。
// 待办与进度就是群体这一行（状态为生成中、已创建数 created）：数据库是持久的，未配置 Redis 时进程重启也不会丢
const groupLeaseTTL = 90 * time.Second

func groupLeaseKey(groupID uint) string {
	return fmt.Sprintf("ai_agent_group:active:%d", groupID)
}

// startGroupGeneration 抢占任务令牌并在后台继续生成；令牌已被占用（正在别处生成）时返回 false
func (s *AIAgentService) startGroupGeneration(groupID uint) bool {
	lease, err := sharedstate.AcquireLease(groupLeaseKey(groupID), groupLeaseTTL)
	if err != nil {
		logrus.Warnf("acquire lease of ai agent group %d: %v", groupID, err)
		return false
	}
	if lease == nil {
		return false
	}
	safeGo("ai agent group generation", func() {
		defer lease.Release()
		s.runGroupGeneration(groupID)
	})
	return true
}

// groupGenerationActive 群体是否正在某个实例上生成（任务令牌存在）
func groupGenerationActive(ids []uint) map[uint]bool {
	result := map[uint]bool{}
	if len(ids) == 0 {
		return result
	}
	keys := make([]string, len(ids))
	for i, id := range ids {
		keys[i] = groupLeaseKey(id)
	}
	values, err := sharedstate.Current().GetMany(keys...)
	if err != nil {
		// 读不到时按正在生成处理，不误报中断
		for _, id := range ids {
			result[id] = true
		}
		return result
	}
	for i, id := range ids {
		_, result[id] = values[keys[i]]
	}
	return result
}

// ResumeAIAgentGroups 接手中途中断的群体生成（由 job_recovery 定时调用）：状态仍为生成中、任务令牌已过期的群体在本实例继续
func ResumeAIAgentGroups() {
	if !tools.GetAIConfig().Configured() {
		return
	}
	groups, err := repo.AIAgent.ListGroupsByStatus(groupStatusGen)
	if err != nil {
		logrus.Warnf("list generating ai agent groups: %v", err)
		return
	}
	svc := NewAIAgentService()
	for i := range groups {
		if svc.startGroupGeneration(groups[i].ID) {
			logrus.Infof("resumed interrupted ai agent group generation %d (%d/%d)", groups[i].ID, groups[i].Created, groups[i].Total)
		}
	}
}

// ResumeGroup 生成失败（如模型连续出错、预算用完）的群体从已创建的数量继续生成
func (s *AIAgentService) ResumeGroup(ctx context.Context, id uint) (*dto.AIAgentGroupDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	if !tools.GetAIConfig().Configured() {
		return nil, errs.NewUnavailable("ai_not_configured")
	}
	group, err := repo.AIAgent.GetGroup(id)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("ai_agent_group")
	}
	if group.Status != groupStatusFailed {
		return nil, errs.NewConflict("ai_agent_group_not_failed")
	}
	if err := repo.AIAgent.UpdateGroup(id, map[string]any{"status": groupStatusGen, "error": ""}); err != nil {
		return nil, errs.Internal("failed_to_update_target", err).WithResource("ai_agent_group")
	}
	s.startGroupGeneration(id)
	return s.GetGroup(ctx, id)
}

func (s *AIAgentService) generateBatch(ctx context.Context, archs []dto.AIAgentArchetype, tpl dto.AIAgentGroupTemplate) ([]dto.AIAgentPreview, error) {
	slots := make([]personaSlot, len(archs))
	for i, a := range archs {
		slots[i] = personaSlot{Archetype: a.Name, Description: a.Description}
	}
	personas, err := generatePersonas(ctx, slots, tpl)
	if err != nil {
		return nil, err
	}
	for i := range personas {
		a := archs[min(i, len(archs)-1)]
		personas[i].DailyActions = a.DailyActionsMin + rand.Float64()*(a.DailyActionsMax-a.DailyActionsMin)
	}
	return personas, nil
}

// runGroupGeneration 后台分批生成并创建账号，调用方持有任务令牌。
// 从群体已创建的数量继续：剩余名额按原型占比重新分配（首次生成时分配后已打乱，已完成的部分相当于随机抽样，剩余按占比分配与原计划一致）。
// 每创建一个账号就把群体的已创建数原子加一，实例中途退出时接手的实例据此算出剩余名额
func (s *AIAgentService) runGroupGeneration(groupID uint) {
	ctx := context.Background()
	group, err := repo.AIAgent.GetGroup(groupID)
	if err != nil || group.Status != groupStatusGen {
		return
	}
	tpl := parseJSONOr(group.Template, dto.AIAgentGroupTemplate{})
	remaining := group.Total - group.Created
	if remaining <= 0 || len(tpl.Archetypes) == 0 {
		_ = repo.AIAgent.UpdateGroup(groupID, map[string]any{"status": groupStatusDone})
		return
	}
	slots := allocateSlots(tpl.Archetypes, remaining)
	for start := 0; start < len(slots); start += groupBatchSize {
		// 再读一次进度：万一令牌过期后被其他实例接手（如长时间连不上 Redis），已满时不再多建
		current, err := repo.AIAgent.GetGroup(groupID)
		if err != nil || current.Status != groupStatusGen {
			return
		}
		if current.Created >= current.Total {
			break
		}
		batch := slots[start:min(start+groupBatchSize, len(slots))]
		var personas []dto.AIAgentPreview
		for attempt := 0; attempt < groupBatchRetries; attempt++ {
			if personas, err = s.generateBatch(ctx, batch, tpl); err == nil && len(personas) > 0 {
				break
			}
			// 预算或频率上限：重试也不会成功
			if errors.Is(err, ErrAgentLLMBudget) {
				break
			}
		}
		if err != nil || len(personas) == 0 {
			msg := "empty response"
			if err != nil {
				msg = err.Error()
			}
			_ = repo.AIAgent.UpdateGroup(groupID, map[string]any{"status": groupStatusFailed, "error": clipRunes(msg, 500)})
			return
		}
		for i, p := range personas {
			arch := batch[min(i, len(batch)-1)]
			profile, svcerr := profileFromPersona(p, arch, tpl)
			if svcerr != nil {
				continue
			}
			username := randomAIUsername()
			avatar := ""
			if tpl.AvatarStyle != "" {
				avatar = fmt.Sprintf("https://api.dicebear.com/9.x/%s/svg?seed=%s", tpl.AvatarStyle, username)
			}
			user, svcerr := newAIUser(username, p.Nickname, avatar)
			if svcerr != nil {
				logrus.Warnf("group %d: build user: %v", groupID, svcerr)
				continue
			}
			gid := groupID
			agent := &model.AIAgent{GroupID: &gid, Tier: tpl.Tier, Status: constant.AIAgentStatusActive, Profile: mustJSON(profile)}
			if err := repo.AIAgent.CreateWithUser(user, agent); err != nil {
				logrus.Warnf("group %d: create agent: %v", groupID, err)
				continue
			}
			SyncSearchUser(user.ID, false)
			if err := repo.AIAgent.IncrGroupCreated(groupID); err != nil {
				logrus.Warnf("group %d: update progress: %v", groupID, err)
			}
		}
	}
	_ = repo.AIAgent.UpdateGroup(groupID, map[string]any{"status": groupStatusDone})
}
