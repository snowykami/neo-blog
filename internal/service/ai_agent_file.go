package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

// 一次最多导入的 AI 用户数
const agentImportMaxItems = 200

// parseIDList 解析逗号分隔的 ID 列表（去重、保持顺序）；有无效项时 ok 为 false
func parseIDList(raw string) (ids []uint, ok bool) {
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := strconv.ParseUint(part, 10, 64)
		if err != nil || id == 0 {
			return nil, false
		}
		if !slices.Contains(ids, uint(id)) {
			ids = append(ids, uint(id))
		}
	}
	return ids, len(ids) > 0
}

// Export 导出 AI 用户：只含账号资料、类型与性格档案；站内地址的头像、背景补全为绝对地址，导入到其他站点也能显示
func (s *AIAgentService) Export(ctx context.Context, req *dto.ExportAIAgentsReq) ([]dto.AIAgentFileItem, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	var agents []model.AIAgent
	switch {
	case req.ID != 0:
		agent, svcerr := s.loadAgent(req.ID)
		if svcerr != nil {
			return nil, svcerr
		}
		agents = []model.AIAgent{*agent}
	case strings.TrimSpace(req.IDs) != "":
		ids, ok := parseIDList(req.IDs)
		if !ok || len(ids) > agentBatchMaxItems {
			return nil, errs.NewBadRequest("invalid_request_parameters")
		}
		var err error
		if agents, err = repo.AIAgent.ListByIDs(ids); err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("ai_agent")
		}
	default:
		var err error
		if agents, err = repo.AIAgent.ListAll(&req.AdminListAIAgentsReq); err != nil {
			return nil, errs.Internal("failed_to_get_target", err).WithResource("ai_agent")
		}
	}
	items := make([]dto.AIAgentFileItem, 0, len(agents))
	for i := range agents {
		user := &agents[i].User
		items = append(items, dto.AIAgentFileItem{
			Username:       user.Username,
			Nickname:       user.Nickname,
			AvatarUrl:      absoluteSiteURL(user.AvatarUrl),
			BackgroundUrl:  absoluteSiteURL(user.BackgroundUrl),
			PreferredColor: user.PreferredColor,
			Tier:           agents[i].Tier,
			Profile:        json.RawMessage(mustJSON(agents[i].ParsedProfile())),
		})
	}
	return items, nil
}

// absoluteSiteURL 站内相对地址（/api/v1/file/...）补全为站点绝对地址
func absoluteSiteURL(u string) string {
	if strings.HasPrefix(u, "/") && !strings.HasPrefix(u, "//") {
		return tools.GetBaseUrl() + u
	}
	return u
}

// Import 导入 AI 用户：按用户名逐个新建或更新，单个失败不影响其他，返回每一项的结果；DryRun 时不写入
func (s *AIAgentService) Import(ctx context.Context, req *dto.ImportAIAgentsReq) ([]dto.ImportAIAgentResult, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	if len(req.Agents) == 0 || len(req.Agents) > agentImportMaxItems {
		return nil, errs.NewBadRequest("invalid_ai_agent_count")
	}
	results := make([]dto.ImportAIAgentResult, 0, len(req.Agents))
	for i := range req.Agents {
		result, svcerr := importAgent(&req.Agents[i], req.DryRun)
		if svcerr != nil {
			if svcerr.Code >= 500 {
				logrus.Errorln("Failed to import ai agent:", svcerr)
			}
			body := svcerr.Body()
			result = dto.ImportAIAgentResult{Error: &body}
		}
		result.Index = i
		results = append(results, result)
	}
	return results, nil
}

// importAgent 导入一个 AI 用户：
//   - 用户名不存在时新建，性格档案缺少的字段取该类型的默认值；
//   - 已有同名 AI 用户时更新它的类型与性格档案，缺少的字段保持原值，昵称、头像等账号资料不变（AI 可能自己改过）；
//   - 用户名被普通账号占用时失败
func importAgent(item *dto.AIAgentFileItem, dryRun bool) (dto.ImportAIAgentResult, *errs.ServiceError) {
	tier := strings.TrimSpace(item.Tier)
	if !(tier == "" || isValidAgentTier(tier)) {
		return dto.ImportAIAgentResult{}, errs.NewBadRequest("invalid_ai_agent_tier")
	}
	username := strings.TrimSpace(item.Username)
	existing, err := repo.User.GetUserByUsername(username)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return dto.ImportAIAgentResult{}, errs.Internal("failed_to_check_target", err).WithResource("user")
	}
	if err == nil {
		return updateImportedAgent(existing, tier, item.Profile, dryRun)
	}

	if tier == "" {
		tier = constant.AIAgentTierAmbient
	}
	profile, svcerr := mergeAgentProfile(DefaultAIAgentProfile(tier), item.Profile)
	if svcerr != nil {
		return dto.ImportAIAgentResult{}, svcerr
	}
	background := strings.TrimSpace(item.BackgroundUrl)
	if !(background == "" || utils.Url.IsValidUrl(background)) {
		return dto.ImportAIAgentResult{}, errs.NewBadRequest("invalid_url")
	}
	color := strings.TrimSpace(item.PreferredColor)
	if !(color == "" || slices.Contains(config.Strings("color_schemes"), color)) {
		return dto.ImportAIAgentResult{}, errs.NewBadRequest("invalid_preferred_color")
	}
	result := dto.ImportAIAgentResult{Action: "create"}
	if dryRun {
		// 只校验账号字段，不生成密码
		_, svcerr = buildAIUser(username, item.Nickname, item.AvatarUrl)
		return result, svcerr
	}
	user, svcerr := newAIUser(username, item.Nickname, item.AvatarUrl)
	if svcerr != nil {
		return dto.ImportAIAgentResult{}, svcerr
	}
	user.BackgroundUrl, user.PreferredColor = background, color
	agent, svcerr := createAgentWithUser(user, tier, profile)
	if svcerr != nil {
		return dto.ImportAIAgentResult{}, svcerr
	}
	result.AgentID = agent.ID
	return result, nil
}

// updateImportedAgent 用导入的类型与性格档案更新已有的 AI 用户
func updateImportedAgent(user *model.User, tier string, raw json.RawMessage, dryRun bool) (dto.ImportAIAgentResult, *errs.ServiceError) {
	if !user.IsAI {
		return dto.ImportAIAgentResult{}, errs.NewConflict("ai_agent_username_taken")
	}
	agent, err := repo.AIAgent.GetByUserID(user.ID)
	if err != nil {
		return dto.ImportAIAgentResult{}, errs.FromDB(err, "ai_agent", "failed_to_get_target")
	}
	if tier == "" {
		tier = agent.Tier
	}
	profile, svcerr := mergeAgentProfile(agent.ParsedProfile(), raw)
	if svcerr != nil {
		return dto.ImportAIAgentResult{}, svcerr
	}
	result := dto.ImportAIAgentResult{Action: "update", AgentID: agent.ID}
	if dryRun {
		return result, nil
	}
	if err := repo.AIAgent.UpdateColumns(agent.ID, map[string]any{"tier": tier, "profile": mustJSON(profile)}); err != nil {
		return dto.ImportAIAgentResult{}, errs.Internal("failed_to_update_target", err).WithResource("ai_agent")
	}
	return result, nil
}

// mergeAgentProfile 把导入的性格档案合并到 base 上：缺少的字段保持 base 的值（嵌套对象逐字段合并，数组整体替换），再校验与规整
func mergeAgentProfile(base dto.AIAgentProfile, raw json.RawMessage) (dto.AIAgentProfile, *errs.ServiceError) {
	if s := strings.TrimSpace(string(raw)); !(s == "" || s == "null") {
		if err := json.Unmarshal(raw, &base); err != nil {
			return base, errs.NewBadRequest("invalid_ai_agent_profile").WithDetail(err.Error())
		}
	}
	return normalizeAgentProfile(base)
}
