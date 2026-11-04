package service

import (
	"context"
	"encoding/json"
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

const personaSystemPrompt = `你在为一个中文技术 / 生活博客生成虚拟社区成员（AI 用户）的人设。这些成员会在博客上浏览文章、点赞和留言。
请严格按要求输出 JSON 数组（不要输出其他内容），数组中每一项对应一个请求的槽位，顺序一致：
[{"nickname": "2~12 个字的昵称，像真实网友，不要带 AI 字样，不要重复",
  "persona": "第一人称，60~150 字：身份、爱好、上网习惯、说话方式；不要冒充具体的真实人物，不要声称医生律师等需要资质的职业",
  "interests": ["3~6 个兴趣，尽量从兴趣池中选，也可以补充相近的"],
  "tone": "≤20 字的语气描述",
  "style_samples": ["2~3 条这个人可能发的短评论，每条 ≤40 字"]}]
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
	raw, err := chatCompletionWithReasoning(callCtx, tools.AIConfig{BaseURL: aiCfg.BaseURL, APIKey: aiCfg.APIKey, Model: modelName}, personaSystemPrompt, user, 0.9, "low")
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
	return nil
}

// profileFromPersona 由生成的人设与原型参数组成性格档案
func profileFromPersona(p dto.AIAgentPreview, arch dto.AIAgentArchetype, tpl dto.AIAgentGroupTemplate) (dto.AIAgentProfile, *errs.ServiceError) {
	profile := DefaultAIAgentProfile(tpl.Tier)
	profile.Archetype = arch.Name
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
	tpl := req.Template
	safeGo("ai agent group generation", func() { s.runGroupGeneration(group.ID, req.Count, tpl) })
	counts := map[uint][2]int64{}
	d := s.groupDto(group, counts)
	return &dto.GenerateAIAgentGroupResp{Group: &d}, nil
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

// runGroupGeneration 后台分批生成并创建账号
func (s *AIAgentService) runGroupGeneration(groupID uint, count int, tpl dto.AIAgentGroupTemplate) {
	ctx := context.Background()
	slots := allocateSlots(tpl.Archetypes, count)
	created := 0
	for start := 0; start < len(slots); start += groupBatchSize {
		batch := slots[start:min(start+groupBatchSize, len(slots))]
		var personas []dto.AIAgentPreview
		var err error
		for attempt := 0; attempt < groupBatchRetries; attempt++ {
			if personas, err = s.generateBatch(ctx, batch, tpl); err == nil && len(personas) > 0 {
				break
			}
		}
		if err != nil || len(personas) == 0 {
			msg := "empty response"
			if err != nil {
				msg = err.Error()
			}
			_ = repo.AIAgent.UpdateGroup(groupID, map[string]any{"status": groupStatusFailed, "error": clipRunes(msg, 500), "created": created})
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
			created++
		}
		_ = repo.AIAgent.UpdateGroup(groupID, map[string]any{"created": created})
	}
	_ = repo.AIAgent.UpdateGroup(groupID, map[string]any{"status": groupStatusDone, "created": created})
}
