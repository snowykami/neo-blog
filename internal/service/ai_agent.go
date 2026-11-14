package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

// AIAgentService AI 用户：管理员管理、调度、worker 的领取与回报、守卫与记忆。
// AI 用户就是 is_ai = true 的普通账号，所有写操作都经过与普通用户相同的 service 权限判断，再额外经过 AgentGuard
type AIAgentService struct{}

func NewAIAgentService() *AIAgentService {
	return &AIAgentService{}
}

const (
	agentMaxActionsPerRun = 5 // 一次运行最多执行的动作数
	agentExpertMaxSteps   = 8 // 专业型阅读阶段最多调用只读工具的轮数
	agentRunMaxAttempts   = 3 // 租约过期后最多重试次数（含首次）
	agentRecentComments   = 8 // 领取任务时附带的自己最近的评论条数，用于避免说话重复
	agentPersonaMaxRunes  = 2000
	agentShortTextRunes   = 200
	agentListMaxItems     = 30
	agentDefaultTimezone  = "Asia/Shanghai"
	agentAIDomainSuffix   = "@ai.invalid" // AI 用户的占位邮箱，.invalid 顶级域保证不会真实投递
)

var (
	agentTriggers        = []string{constant.AgentTriggerBrowse, constant.AgentTriggerPostPublished, constant.AgentTriggerCommentReplied, constant.AgentTriggerCommentMentioned}
	agentSelfEditFields  = []string{"avatar", "background", "nickname", "preferred_color"}
	agentLanguagePattern = regexp.MustCompile(`^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|[0-9]{3}))?$`)
)

// NormalizeAgentLanguage 规整并校验 AI 用户主要输出语言代码（BCP 47）；允许留空，中文统一归并为 zh / zh-tw
func NormalizeAgentLanguage(code string) (string, bool) {
	code = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(code), "_", "-"))
	if code == "" {
		return "", true
	}
	switch code {
	case "zh", "zh-cn", "zh-sg", "zh-my", "zh-hans", "zh-hans-cn", "zh-hans-sg":
		return "zh", true
	case "zh-tw", "zh-hk", "zh-mo", "zh-hant", "zh-hant-tw", "zh-hant-hk", "zh-hant-mo":
		return "zh-tw", true
	}
	if len(code) > 16 || !agentLanguagePattern.MatchString(code) {
		return "", false
	}
	return code, true
}

// DefaultAIAgentProfile 各类型的默认性格档案
func DefaultAIAgentProfile(tier string) dto.AIAgentProfile {
	p := dto.AIAgentProfile{
		Persona:       "",
		Interests:     []string{},
		Expertise:     []string{},
		Tone:          "自然、简短、真诚",
		StyleSamples:  []string{},
		Activity:      dto.AIAgentActivity{DailyActions: 2, ActiveHours: "12-14,20-24", Timezone: agentDefaultTimezone, WeekendFactor: 1.2},
		Behavior:      dto.AIAgentBehavior{Lurk: 0.5, Like: 0.4, Comment: 0.1, ReplyProbability: 0.6, DigOldPosts: 0.1, DelayMinMinutes: 3, DelayMaxMinutes: 40},
		Limits:        dto.AIAgentLimits{CommentsPerDay: 3, LikesPerDay: 20, CommentsPerPost: 1, CooldownMinutes: 30},
		Triggers:      slices.Clone(agentTriggers),
		BlockedTopics: []string{"政治", "医疗建议", "投资建议"},
		AIInteraction: dto.AIAgentAIInteraction{Enabled: true, BaseProbability: 0.4},
		SelfEdit:      dto.AIAgentSelfEdit{Enabled: true, Fields: slices.Clone(agentSelfEditFields), Hint: "很少修改资料，一个月最多一两次，除非有明确理由"},
		Memory:        dto.AIAgentMemoryConfig{RememberPeople: true, MaxItems: 200, MilestoneFamiliarity: 0.6},
		WebFetch:      dto.AIAgentWebFetch{Enabled: false, AllowedDomains: []string{}},
	}
	if tier == constant.AIAgentTierExpert {
		// 不写「先肯定再补充」这类结构要求，模型会照着写成固定的三段式
		p.Tone = "具体、直给，像懂行的网友顺手补一句，不说教"
		p.Activity = dto.AIAgentActivity{DailyActions: 1.5, ActiveHours: "9-12,14-18", Timezone: agentDefaultTimezone, WeekendFactor: 0.8}
		p.Behavior = dto.AIAgentBehavior{Lurk: 0.3, Like: 0.3, Comment: 0.4, ReplyProbability: 0.8, DigOldPosts: 0.05, DelayMinMinutes: 10, DelayMaxMinutes: 90}
		p.Limits = dto.AIAgentLimits{CommentsPerDay: 3, LikesPerDay: 10, CommentsPerPost: 1, CooldownMinutes: 60}
		p.Memory.MaxItems = 300
		p.WebFetch.Enabled = true
	}
	return p
}

func isValidAgentTier(tier string) bool {
	return tier == constant.AIAgentTierAmbient || tier == constant.AIAgentTierExpert
}

func clamp01(v float64) float64 {
	if math.IsNaN(v) {
		return 0
	}
	return math.Max(0, math.Min(1, v))
}

func clampInt(v, lo, hi int) int {
	return max(lo, min(hi, v))
}

func clipRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// cleanList 去空白、去重、限制条数与长度
func cleanList(items []string, maxItems, maxRunes int) []string {
	result := make([]string, 0, len(items))
	for _, item := range items {
		item = clipRunes(item, maxRunes)
		if item == "" || slices.Contains(result, item) {
			continue
		}
		result = append(result, item)
		if len(result) >= maxItems {
			break
		}
	}
	return result
}

// parseActiveHours 解析作息，返回 24 个小时的活跃权重；格式如 "9-12,20-24"，"22-2" 表示跨零点，留空为全天
func parseActiveHours(spec string) ([24]float64, error) {
	var weights [24]float64
	spec = strings.TrimSpace(spec)
	if spec == "" {
		for i := range weights {
			weights[i] = 1
		}
		return weights, nil
	}
	// 非作息时间保留很低的权重：偶尔也会醒来
	for i := range weights {
		weights[i] = 0.05
	}
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		from, to, ok := strings.Cut(part, "-")
		if !ok {
			return weights, fmt.Errorf("invalid range %q", part)
		}
		start, err1 := strconv.Atoi(strings.TrimSpace(from))
		end, err2 := strconv.Atoi(strings.TrimSpace(to))
		if err1 != nil || err2 != nil || start < 0 || start > 24 || end < 0 || end > 24 {
			return weights, fmt.Errorf("invalid range %q", part)
		}
		// 24 点即 0 点；"0-24" 表示全天，起止相同的其他写法为空区间
		from24, to24 := start%24, end%24
		if from24 == to24 {
			if start != end {
				for h := range weights {
					weights[h] = 1
				}
			}
			continue
		}
		for h := from24; h != to24; h = (h + 1) % 24 {
			weights[h] = 1
		}
	}
	return weights, nil
}

// normalizeAgentProfile 校验并规整性格档案
func normalizeAgentProfile(p dto.AIAgentProfile) (dto.AIAgentProfile, *errs.ServiceError) {
	p.Archetype = clipRunes(p.Archetype, 40)
	lang, ok := NormalizeAgentLanguage(p.Language)
	if !ok {
		return p, errs.NewBadRequest("invalid_language")
	}
	p.Language = lang
	p.Persona = clipRunes(p.Persona, agentPersonaMaxRunes)
	p.Tone = clipRunes(p.Tone, agentShortTextRunes)
	p.Interests = cleanList(p.Interests, agentListMaxItems, 30)
	p.Expertise = cleanList(p.Expertise, agentListMaxItems, 30)
	p.StyleSamples = cleanList(p.StyleSamples, 10, agentShortTextRunes)
	p.BlockedTopics = cleanList(p.BlockedTopics, agentListMaxItems, 30)
	p.ModelOverride = clipRunes(p.ModelOverride, 128)

	p.Activity.DailyActions = math.Max(0, math.Min(48, p.Activity.DailyActions))
	p.Activity.WeekendFactor = math.Max(0, math.Min(5, p.Activity.WeekendFactor))
	p.Activity.ActiveHours = strings.TrimSpace(p.Activity.ActiveHours)
	if _, err := parseActiveHours(p.Activity.ActiveHours); err != nil {
		return p, errs.NewBadRequest("invalid_active_hours")
	}
	if strings.TrimSpace(p.Activity.Timezone) == "" {
		p.Activity.Timezone = agentDefaultTimezone
	}
	timezone, ok := utils.NormalizeTimeZone(p.Activity.Timezone)
	if !ok {
		return p, errs.NewBadRequest("invalid_timezone")
	}
	p.Activity.Timezone = timezone

	b := &p.Behavior
	b.Lurk, b.Like, b.Comment = clamp01(b.Lurk), clamp01(b.Like), clamp01(b.Comment)
	b.ReplyProbability, b.DigOldPosts = clamp01(b.ReplyProbability), clamp01(b.DigOldPosts)
	b.DelayMinMinutes = clampInt(b.DelayMinMinutes, 0, 24*60)
	b.DelayMaxMinutes = clampInt(b.DelayMaxMinutes, b.DelayMinMinutes, 24*60)

	l := &p.Limits
	l.CommentsPerDay = clampInt(l.CommentsPerDay, 0, 1000)
	l.LikesPerDay = clampInt(l.LikesPerDay, 0, 10000)
	l.CommentsPerPost = clampInt(l.CommentsPerPost, 0, 100)
	l.CooldownMinutes = clampInt(l.CooldownMinutes, 0, 7*24*60)

	triggers := make([]string, 0, len(p.Triggers))
	for _, t := range p.Triggers {
		if slices.Contains(agentTriggers, t) && !slices.Contains(triggers, t) {
			triggers = append(triggers, t)
		}
	}
	p.Triggers = triggers

	p.AIInteraction.BaseProbability = clamp01(p.AIInteraction.BaseProbability)
	fields := make([]string, 0, len(p.SelfEdit.Fields))
	for _, f := range p.SelfEdit.Fields {
		if slices.Contains(agentSelfEditFields, f) && !slices.Contains(fields, f) {
			fields = append(fields, f)
		}
	}
	p.SelfEdit.Fields = fields
	p.SelfEdit.Hint = clipRunes(p.SelfEdit.Hint, agentShortTextRunes)

	p.Memory.RetentionDays = clampInt(p.Memory.RetentionDays, 0, 3650)
	p.Memory.MaxItems = clampInt(p.Memory.MaxItems, 0, 5000)
	if p.Memory.MilestoneFamiliarity <= 0 {
		p.Memory.MilestoneFamiliarity = 0.6
	}
	p.Memory.MilestoneFamiliarity = clamp01(p.Memory.MilestoneFamiliarity)

	domains := make([]string, 0, len(p.WebFetch.AllowedDomains))
	for _, d := range cleanList(p.WebFetch.AllowedDomains, 50, 100) {
		domains = append(domains, strings.ToLower(strings.TrimPrefix(strings.TrimPrefix(d, "https://"), "http://")))
	}
	p.WebFetch.AllowedDomains = domains
	return p, nil
}

func mustJSON(v any) string {
	data, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(data)
}

func parseJSONOr[T any](s string, fallback T) T {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	var v T
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return fallback
	}
	return v
}

func dayStart(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

func monthStart(t time.Time) time.Time {
	y, m, _ := t.Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, t.Location())
}

// agentModel 本次运行使用的模型：个体覆盖 > 按类型的全站配置 > ai_model
func agentModel(agent *model.AIAgent, profile dto.AIAgentProfile, cfg tools.AIAgentConfig, aiCfg tools.AIConfig) string {
	if profile.ModelOverride != "" {
		return profile.ModelOverride
	}
	if agent.Tier == constant.AIAgentTierExpert && cfg.ModelExpert != "" {
		return cfg.ModelExpert
	}
	if agent.Tier != constant.AIAgentTierExpert && cfg.ModelAmbient != "" {
		return cfg.ModelAmbient
	}
	return aiCfg.Model
}

func briefUser(u *model.User) dto.AgentUserBrief {
	return dto.AgentUserBrief{ID: u.ID, Username: u.Username, Nickname: u.Nickname, AvatarUrl: u.AvatarUrl}
}

func displayName(u *model.User) string {
	if u.Nickname != "" {
		return u.Nickname
	}
	return u.Username
}

// ---------- 管理接口 ----------

func (s *AIAgentService) toDto(agent *model.AIAgent, groupNames map[uint]string, withCounts bool) dto.AIAgentDto {
	d := dto.AIAgentDto{
		ID:           agent.ID,
		User:         agent.User.ToPrivateDto(),
		Tier:         agent.Tier,
		Status:       agent.Status,
		PausedReason: agent.PausedReason,
		GroupID:      agent.GroupID,
		Profile:      agent.ParsedProfile(),
		SelfSummary:  agent.SelfSummary,
		LastActiveAt: agent.LastActiveAt,
		CreatedAt:    agent.CreatedAt,
	}
	if agent.GroupID != nil {
		d.GroupName = groupNames[*agent.GroupID]
	}
	if withCounts {
		now := time.Now()
		d.TodayComments, _ = repo.AIAgent.CountUserComments(agent.UserID, dayStart(now))
		d.TodayLikes, _ = repo.AIAgent.CountUserLikes(agent.UserID, dayStart(now))
		tokens, _ := repo.AIAgent.SumTokensByAgent([]uint{agent.ID}, monthStart(now))
		d.MonthTokens = tokens[agent.ID]
	}
	return d
}

func (s *AIAgentService) loadAgent(id uint) (*model.AIAgent, *errs.ServiceError) {
	agent, err := repo.AIAgent.GetByID(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("ai_agent")
		}
		return nil, errs.Internal("failed_to_get_target", err).WithResource("ai_agent")
	}
	return agent, nil
}

func (s *AIAgentService) agentDto(agent *model.AIAgent) *dto.AIAgentDto {
	names := map[uint]string{}
	if agent.GroupID != nil {
		names, _ = repo.AIAgent.GroupNames([]uint{*agent.GroupID})
	}
	d := s.toDto(agent, names, true)
	return &d
}

// List 管理后台列表
func (s *AIAgentService) List(ctx context.Context, req *dto.AdminListAIAgentsReq) ([]dto.AIAgentDto, int64, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, 0, svcerr
	}
	agents, total, err := repo.AIAgent.List(req)
	if err != nil {
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("ai_agent")
	}
	groupIDs := make([]uint, 0)
	agentIDs := make([]uint, 0, len(agents))
	userIDs := make([]uint, 0, len(agents))
	for _, a := range agents {
		agentIDs = append(agentIDs, a.ID)
		userIDs = append(userIDs, a.UserID)
		if a.GroupID != nil {
			groupIDs = append(groupIDs, *a.GroupID)
		}
	}
	names, _ := repo.AIAgent.GroupNames(groupIDs)
	now := time.Now()
	tokens, _ := repo.AIAgent.SumTokensByAgent(agentIDs, monthStart(now))
	// 今日评论与点赞按用户分组一次查出整页，不逐个查询
	comments, _ := repo.AIAgent.CountCommentsByUsers(userIDs, dayStart(now))
	likes, _ := repo.AIAgent.CountLikesByUsers(userIDs, dayStart(now))
	result := make([]dto.AIAgentDto, 0, len(agents))
	for i := range agents {
		d := s.toDto(&agents[i], names, false)
		d.TodayComments = comments[agents[i].UserID]
		d.TodayLikes = likes[agents[i].UserID]
		d.MonthTokens = tokens[agents[i].ID]
		result = append(result, d)
	}
	return result, total, nil
}

// Stats 总览与全站额度
func (s *AIAgentService) Stats(ctx context.Context) (*dto.AIAgentStatsDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	cfg := tools.GetAIAgentConfig()
	now := time.Now()
	stats := &dto.AIAgentStatsDto{
		Enabled:             cfg.Enabled,
		AIConfigured:        tools.GetAIConfig().Configured(),
		CommentsPerDayLimit: cfg.CommentsPerDay,
		LikesPerDayLimit:    cfg.LikesPerDay,
		LLMCallsPerHour:     cfg.LLMCallsPerHour,
		MonthlyTokenBudget:  cfg.MonthlyTokenBudget,
	}
	stats.Total, _ = repo.AIAgent.CountBy("", "")
	stats.Ambient, _ = repo.AIAgent.CountBy("tier", constant.AIAgentTierAmbient)
	stats.Expert, _ = repo.AIAgent.CountBy("tier", constant.AIAgentTierExpert)
	stats.Active, _ = repo.AIAgent.CountBy("status", constant.AIAgentStatusActive)
	stats.Paused, _ = repo.AIAgent.CountBy("status", constant.AIAgentStatusPaused)
	if groups, err := repo.AIAgent.ListGroups(); err == nil {
		stats.Groups = int64(len(groups))
	}
	stats.QueuedRuns, _ = repo.AIAgent.CountRunsByStatus(constant.AgentRunStatusQueued)
	stats.TodayComments, _ = repo.AIAgent.CountAIComments(dayStart(now))
	stats.TodayLikes, _ = repo.AIAgent.CountAILikes(dayStart(now))
	stats.HourLLMCalls = hourLLMCalls(now)
	stats.MonthTokens, _ = repo.AIAgent.SumTokens(monthStart(now))
	if v, ok, _ := sharedstate.Current().Get(agentRunnerSeenKey); ok {
		if ts, err := strconv.ParseInt(v, 10, 64); err == nil {
			stats.RunnerOnline = now.Sub(time.Unix(ts, 0)) < 2*time.Minute
		}
	}
	return stats, nil
}

// Get 单个 AI 用户
func (s *AIAgentService) Get(ctx context.Context, id uint) (*dto.AIAgentDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	agent, svcerr := s.loadAgent(id)
	if svcerr != nil {
		return nil, svcerr
	}
	return s.agentDto(agent), nil
}

func resolveProfile(tier string, profile *dto.AIAgentProfile) (dto.AIAgentProfile, *errs.ServiceError) {
	if profile == nil {
		return DefaultAIAgentProfile(tier), nil
	}
	return normalizeAgentProfile(*profile)
}

// Create 新建 AI 用户（同时创建账号；账号为普通用户角色，随机密码且不能密码登录）
func (s *AIAgentService) Create(ctx context.Context, req *dto.CreateAIAgentReq) (*dto.AIAgentDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	if req.Tier == "" {
		req.Tier = constant.AIAgentTierAmbient
	}
	if !isValidAgentTier(req.Tier) {
		return nil, errs.NewBadRequest("invalid_ai_agent_tier")
	}
	profile, svcerr := resolveProfile(req.Tier, req.Profile)
	if svcerr != nil {
		return nil, svcerr
	}
	user, svcerr := newAIUser(req.Username, req.Nickname, req.AvatarUrl)
	if svcerr != nil {
		return nil, svcerr
	}
	agent, svcerr := createAgentWithUser(user, req.Tier, profile)
	if svcerr != nil {
		return nil, svcerr
	}
	return s.agentDto(agent), nil
}

// createAgentWithUser 在同一事务中创建 AI 用户的账号与 Agent 配置
func createAgentWithUser(user *model.User, tier string, profile dto.AIAgentProfile) (*model.AIAgent, *errs.ServiceError) {
	agent := &model.AIAgent{Tier: tier, Status: constant.AIAgentStatusActive, Profile: mustJSON(profile)}
	if err := repo.AIAgent.CreateWithUser(user, agent); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, errs.NewConflict("username_or_email_already_exists")
		}
		return nil, errs.Internal("failed_to_create_target", err).WithResource("ai_agent")
	}
	agent.User = *user
	SyncSearchUser(user.ID, false)
	return agent, nil
}

// newAIUser 构造 AI 用户的账号：占位邮箱、随机密码（不可登录）
func newAIUser(username, nickname, avatarURL string) (*model.User, *errs.ServiceError) {
	user, svcerr := buildAIUser(username, nickname, avatarURL)
	if svcerr != nil {
		return nil, svcerr
	}
	password, err := utils.Password.HashPassword(utils.Strings.GenerateRandomString(48))
	if err != nil {
		return nil, errs.Internal("failed_to_create_target", err).WithResource("user")
	}
	user.Password = password
	return user, nil
}

// buildAIUser 校验 AI 用户的账号字段、确认用户名与占位邮箱未被占用，构造不含密码的账号
func buildAIUser(username, nickname, avatarURL string) (*model.User, *errs.ServiceError) {
	username = strings.TrimSpace(username)
	nickname = strings.TrimSpace(nickname)
	avatarURL = strings.TrimSpace(avatarURL)
	if !isValidUsername(username) {
		return nil, errs.NewBadRequest("invalid_username")
	}
	if utf8.RuneCountInString(nickname) > nicknameMaxLen {
		return nil, errs.NewBadRequest("invalid_nickname")
	}
	if !(avatarURL == "" || utils.Url.IsValidUrl(avatarURL)) {
		return nil, errs.NewBadRequest("invalid_url")
	}
	email := strings.ToLower(username) + agentAIDomainSuffix
	if svcerr := checkUsernameEmailFree(username, email, 0); svcerr != nil {
		return nil, svcerr
	}
	if nickname == "" {
		nickname = username
	}
	return &model.User{
		Username:  username,
		Nickname:  nickname,
		Email:     email,
		Role:      constant.RoleUser,
		AvatarUrl: avatarURL,
		IsAI:      true,
	}, nil
}

// ConvertUser 把已有普通用户设为 AI 用户：只能是普通用户角色，会吊销其全部会话与个人 Token
func (s *AIAgentService) ConvertUser(ctx context.Context, req *dto.ConvertUserToAIReq) (*dto.AIAgentDto, *errs.ServiceError) {
	_, target, svcerr := getManagedUser(ctx, req.ID, true)
	if svcerr != nil {
		return nil, svcerr
	}
	if target.Role != constant.RoleUser {
		return nil, errs.NewForbidden("ai_user_role_must_be_user")
	}
	if target.IsAI {
		return nil, errs.NewConflict("already_ai_user")
	}
	if req.Tier == "" {
		req.Tier = constant.AIAgentTierAmbient
	}
	if !isValidAgentTier(req.Tier) {
		return nil, errs.NewBadRequest("invalid_ai_agent_tier")
	}
	profile, svcerr := resolveProfile(req.Tier, req.Profile)
	if svcerr != nil {
		return nil, svcerr
	}
	agent := &model.AIAgent{UserID: target.ID, Tier: req.Tier, Status: constant.AIAgentStatusActive, Profile: mustJSON(profile)}
	err := repo.GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.User{}).Where("id = ?", target.ID).Update("is_ai", true).Error; err != nil {
			return err
		}
		return tx.Create(agent).Error
	})
	if err != nil {
		return nil, errs.Internal("failed_to_update_target", err).WithResource("user")
	}
	if err := repo.Session.RevokeUserSessions(target.ID, ""); err != nil {
		logrus.Errorln("Failed to revoke sessions:", err)
	}
	if err := repo.APIToken.RevokeAllByUser(target.ID, time.Now()); err != nil {
		logrus.Errorln("Failed to revoke api tokens:", err)
	}
	target.IsAI = true
	agent.User = *target
	return s.agentDto(agent), nil
}

// Update 修改类型与性格档案
func (s *AIAgentService) Update(ctx context.Context, req *dto.UpdateAIAgentReq) (*dto.AIAgentDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	agent, svcerr := s.loadAgent(req.ID)
	if svcerr != nil {
		return nil, svcerr
	}
	columns := map[string]any{}
	if req.Tier != "" {
		if !isValidAgentTier(req.Tier) {
			return nil, errs.NewBadRequest("invalid_ai_agent_tier")
		}
		columns["tier"] = req.Tier
		agent.Tier = req.Tier
	}
	if req.Profile != nil {
		profile, svcerr := normalizeAgentProfile(*req.Profile)
		if svcerr != nil {
			return nil, svcerr
		}
		columns["profile"] = mustJSON(profile)
		agent.Profile = columns["profile"].(string)
	}
	if len(columns) > 0 {
		if err := repo.AIAgent.UpdateColumns(agent.ID, columns); err != nil {
			return nil, errs.Internal("failed_to_update_target", err).WithResource("ai_agent")
		}
	}
	return s.agentDto(agent), nil
}

// SetStatus 暂停 / 恢复
func (s *AIAgentService) SetStatus(ctx context.Context, id uint, status string) *errs.ServiceError {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return svcerr
	}
	if !(status == constant.AIAgentStatusActive || status == constant.AIAgentStatusPaused) {
		return errs.NewBadRequest("invalid_status")
	}
	agent, svcerr := s.loadAgent(id)
	if svcerr != nil {
		return svcerr
	}
	reason := ""
	if status == constant.AIAgentStatusPaused {
		reason = "manual"
	}
	if err := repo.AIAgent.UpdateColumns(agent.ID, map[string]any{"status": status, "paused_reason": reason}); err != nil {
		return errs.Internal("failed_to_update_target", err).WithResource("ai_agent")
	}
	return nil
}

// Delete 取消 AI 身份：删除性格、记忆、关系与运行记录，账号保留为普通用户（需管理员重置密码后才能登录）
func (s *AIAgentService) Delete(ctx context.Context, id uint) *errs.ServiceError {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return svcerr
	}
	agent, svcerr := s.loadAgent(id)
	if svcerr != nil {
		return svcerr
	}
	if err := repo.AIAgent.Delete(agent); err != nil {
		return errs.Internal("failed_to_delete_target", err).WithResource("ai_agent")
	}
	return nil
}

// agentBatchMaxItems 一次批量操作或导出勾选项最多的 AI 用户数
const agentBatchMaxItems = 500

// Batch 批量暂停、恢复或取消 AI 身份；某一个失败（如已不存在）只记入 Failed，不影响其他
func (s *AIAgentService) Batch(ctx context.Context, req *dto.BatchAIAgentsReq) (*dto.BatchAIAgentsResp, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	ids := make([]uint, 0, len(req.IDs))
	for _, id := range req.IDs {
		if id != 0 && !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 || len(ids) > agentBatchMaxItems {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	var apply func(id uint) *errs.ServiceError
	switch req.Action {
	case "pause":
		apply = func(id uint) *errs.ServiceError { return s.SetStatus(ctx, id, constant.AIAgentStatusPaused) }
	case "resume":
		apply = func(id uint) *errs.ServiceError { return s.SetStatus(ctx, id, constant.AIAgentStatusActive) }
	case "delete":
		apply = func(id uint) *errs.ServiceError { return s.Delete(ctx, id) }
	default:
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	result := &dto.BatchAIAgentsResp{Failed: []uint{}}
	for _, id := range ids {
		if svcerr := apply(id); svcerr != nil {
			result.Failed = append(result.Failed, id)
			continue
		}
		result.Succeeded++
	}
	return result, nil
}

// DryRun 试运行：创建一个只读的运行（租约令牌没有写权限），Runner 输出操作列表但不执行
func (s *AIAgentService) DryRun(ctx context.Context, req *dto.AIAgentDryRunReq) (*dto.AgentRunDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	agent, svcerr := s.loadAgent(req.ID)
	if svcerr != nil {
		return nil, svcerr
	}
	switch req.TargetType {
	case constant.TargetTypePost:
		post, err := repo.Post.GetPostByID(req.TargetID)
		if err != nil || !post.IsPublic() {
			return nil, errs.NewNotFound("target_not_found").WithResource("post")
		}
	case constant.TargetTypeComment:
		if _, err := repo.Comment.GetComment(req.TargetID); err != nil {
			return nil, errs.NewNotFound("target_not_found").WithResource("comment")
		}
	default:
		return nil, errs.NewBadRequest("invalid_target_type")
	}
	run := &model.AgentRun{
		AgentID:     agent.ID,
		Kind:        constant.AgentRunKindDryRun,
		Trigger:     constant.AgentTriggerDryRun,
		TargetType:  req.TargetType,
		TargetID:    req.TargetID,
		Status:      constant.AgentRunStatusQueued,
		ScheduledAt: time.Now().Add(-24 * time.Hour), // 提前计划时间，排在所有待办之前
	}
	if err := repo.AIAgent.CreateRun(run); err != nil {
		return nil, errs.Internal("failed_to_create_target", err).WithResource("agent_run")
	}
	notifyAgentRuns()
	d := s.runDtos([]model.AgentRun{*run})[0]
	return &d, nil
}

// ---------- 运行记录 ----------

func (s *AIAgentService) runDtos(runs []model.AgentRun) []dto.AgentRunDto {
	agentIDs := make([]uint, 0, len(runs))
	postIDs := make([]uint, 0)
	commentIDs := make([]uint, 0)
	for _, r := range runs {
		agentIDs = append(agentIDs, r.AgentID)
		switch r.TargetType {
		case constant.TargetTypePost:
			postIDs = append(postIDs, r.TargetID)
		case constant.TargetTypeComment:
			commentIDs = append(commentIDs, r.TargetID)
		}
	}
	agentUsers := map[uint]dto.AgentUserBrief{}
	var agents []model.AIAgent
	if len(agentIDs) > 0 && repo.GetDB().Preload("User").Where("id IN ?", agentIDs).Find(&agents).Error == nil {
		for i := range agents {
			agentUsers[agents[i].ID] = briefUser(&agents[i].User)
		}
	}
	titles := map[string]string{}
	if posts, err := repo.AIAgent.PostsByIDs(postIDs); err == nil {
		for _, p := range posts {
			titles[fmt.Sprintf("post:%d", p.ID)] = p.Title
		}
	}
	for _, id := range commentIDs {
		if c, err := repo.Comment.GetComment(id); err == nil {
			titles[fmt.Sprintf("comment:%d", id)] = clipRunes(c.Content, 60)
		}
	}
	result := make([]dto.AgentRunDto, 0, len(runs))
	for _, r := range runs {
		d := dto.AgentRunDto{
			ID:               r.ID,
			AgentID:          r.AgentID,
			Kind:             r.Kind,
			Trigger:          r.Trigger,
			TargetType:       r.TargetType,
			TargetID:         r.TargetID,
			TargetTitle:      titles[fmt.Sprintf("%s:%d", r.TargetType, r.TargetID)],
			Status:           r.Status,
			SkipReason:       r.SkipReason,
			ScheduledAt:      r.ScheduledAt,
			FinishedAt:       r.FinishedAt,
			Actions:          parseJSONOr(r.Actions, []dto.AgentActionDto{}),
			Effects:          parseJSONOr(r.Effects, []dto.AgentEffectDto{}),
			Reason:           r.Reason,
			MemoryNote:       r.MemoryNote,
			Model:            r.Model,
			PromptTokens:     r.PromptTokens,
			CachedTokens:     r.CachedTokens,
			CompletionTokens: r.CompletionTokens,
			LLMCalls:         r.LLMCalls,
			Trace:            parseJSONOr(r.Trace, []dto.AgentTraceStep{}),
			Error:            r.Error,
			Reverted:         r.Reverted,
			CreatedAt:        r.CreatedAt,
		}
		if u, ok := agentUsers[r.AgentID]; ok {
			d.Agent = &u
		}
		result = append(result, d)
	}
	return result
}

func (s *AIAgentService) ListRuns(ctx context.Context, req *dto.ListAgentRunsReq) ([]dto.AgentRunDto, int64, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, 0, svcerr
	}
	runs, total, err := repo.AIAgent.ListRuns(req)
	if err != nil {
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("agent_run")
	}
	return s.runDtos(runs), total, nil
}

func (s *AIAgentService) GetRun(ctx context.Context, id uint) (*dto.AgentRunDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	run, err := repo.AIAgent.GetRun(id)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("agent_run")
	}
	d := s.runDtos([]model.AgentRun{*run})[0]
	return &d, nil
}

// RevertRun 撤回一次运行的实际写入：删除产生的评论、取消 / 恢复点赞、回滚资料修改
func (s *AIAgentService) RevertRun(ctx context.Context, id uint) (*dto.AgentRunDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	run, err := repo.AIAgent.GetRun(id)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("agent_run")
	}
	agent, svcerr := s.loadAgent(run.AgentID)
	if svcerr != nil {
		return nil, svcerr
	}
	effects := parseJSONOr(run.Effects, []dto.AgentEffectDto{})
	// 点赞以 AI 用户的身份撤销，评论以管理员身份删除（管理员可删除任意评论）
	agentCtx := context.WithValue(context.Background(), "user_id", agent.UserID)
	for i := len(effects) - 1; i >= 0; i-- {
		e := &effects[i]
		if e.Reverted {
			continue
		}
		switch e.Type {
		case "comment":
			if svcerr := NewCommentService().DeleteComment(ctx, e.CommentID); svcerr != nil && svcerr.Code != 404 {
				return nil, svcerr
			}
		case "like":
			undo := !e.Liked
			if _, svcerr := NewLikeService().ToggleLike(agentCtx, e.TargetID, e.TargetType, &undo); svcerr != nil && svcerr.Code != 404 {
				return nil, svcerr
			}
		case "profile":
			if err := repo.User.UpdateUserColumns(agent.UserID, map[string]any{e.Field: e.Old}); err != nil {
				return nil, errs.Internal("failed_to_update_target", err).WithResource("user")
			}
		}
		e.Reverted = true
	}
	if err := repo.AIAgent.UpdateRun(run.ID, map[string]any{"effects": mustJSON(effects), "reverted": true}); err != nil {
		return nil, errs.Internal("failed_to_update_target", err).WithResource("agent_run")
	}
	return s.GetRun(ctx, id)
}

// ---------- 记忆与关系（管理员） ----------

func (s *AIAgentService) memoryDtos(memories []model.AgentMemory) []dto.AgentMemoryDto {
	userIDs := make([]uint, 0)
	for _, m := range memories {
		if m.SubjectUserID != nil {
			userIDs = append(userIDs, *m.SubjectUserID)
		}
	}
	users, _ := repo.AIAgent.UsersBrief(userIDs)
	result := make([]dto.AgentMemoryDto, 0, len(memories))
	for _, m := range memories {
		d := dto.AgentMemoryDto{
			ID: m.ID, AgentID: m.AgentID, Kind: m.Kind, SubjectUserID: m.SubjectUserID, TargetType: m.TargetType, TargetID: m.TargetID,
			Content: m.Content, Importance: m.Importance, Pinned: m.Pinned, SourceRunID: m.SourceRunID, ExpiresAt: m.ExpiresAt, CreatedAt: m.CreatedAt,
		}
		if m.SubjectUserID != nil {
			if u, ok := users[*m.SubjectUserID]; ok {
				d.SubjectName = displayName(&u)
			}
		}
		result = append(result, d)
	}
	return result
}

func (s *AIAgentService) ListMemories(ctx context.Context, req *dto.ListAgentMemoriesReq) ([]dto.AgentMemoryDto, int64, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, 0, svcerr
	}
	memories, total, err := repo.AIAgent.ListMemories(req)
	if err != nil {
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("agent_memory")
	}
	return s.memoryDtos(memories), total, nil
}

func (s *AIAgentService) UpdateMemory(ctx context.Context, req *dto.UpdateAgentMemoryReq) *errs.ServiceError {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return svcerr
	}
	if _, err := repo.AIAgent.GetMemory(req.ID); err != nil {
		return errs.NewNotFound("target_not_found").WithResource("agent_memory")
	}
	columns := map[string]any{}
	if req.Content != nil {
		content := clipRunes(*req.Content, agentShortTextRunes)
		if content == "" {
			return errs.NewBadRequest("content_cannot_be_empty")
		}
		columns["content"] = content
	}
	if req.Importance != nil {
		columns["importance"] = clamp01(*req.Importance)
	}
	if req.Pinned != nil {
		columns["pinned"] = *req.Pinned
	}
	if len(columns) == 0 {
		return nil
	}
	if err := repo.AIAgent.UpdateMemory(req.ID, columns); err != nil {
		return errs.Internal("failed_to_update_target", err).WithResource("agent_memory")
	}
	return nil
}

func (s *AIAgentService) DeleteMemory(ctx context.Context, id uint) *errs.ServiceError {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return svcerr
	}
	if err := repo.AIAgent.DeleteMemory(id); err != nil {
		return errs.Internal("failed_to_delete_target", err).WithResource("agent_memory")
	}
	return nil
}

func (s *AIAgentService) ListRelations(ctx context.Context, agentID uint, page, size int) ([]dto.AgentRelationDto, int64, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, 0, svcerr
	}
	rels, total, err := repo.AIAgent.ListRelations(agentID, page, size)
	if err != nil {
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("agent_relation")
	}
	userIDs := make([]uint, 0, len(rels))
	for _, r := range rels {
		userIDs = append(userIDs, r.UserID)
	}
	users, _ := repo.AIAgent.UsersBrief(userIDs)
	result := make([]dto.AgentRelationDto, 0, len(rels))
	for _, r := range rels {
		u := users[r.UserID]
		result = append(result, dto.AgentRelationDto{
			ID: r.ID, AgentID: r.AgentID, User: briefUser(&u), Familiarity: currentFamiliarity(&r, time.Now()),
			Impression: r.Impression, Topics: parseJSONOr(r.Topics, []string{}), Interactions: r.Interactions,
			LastInteractedAt: r.LastInteractedAt, MilestoneAt: r.MilestoneAt,
		})
	}
	return result, total, nil
}

func (s *AIAgentService) DeleteRelation(ctx context.Context, id uint) *errs.ServiceError {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return svcerr
	}
	if err := repo.AIAgent.DeleteRelation(id); err != nil {
		return errs.Internal("failed_to_delete_target", err).WithResource("agent_relation")
	}
	return nil
}

// ---------- 群体 ----------

func (s *AIAgentService) groupDto(g *model.AIAgentGroup, counts map[uint][2]int64) dto.AIAgentGroupDto {
	c := counts[g.ID]
	return dto.AIAgentGroupDto{
		ID: g.ID, Name: g.Name, Template: parseJSONOr(g.Template, dto.AIAgentGroupTemplate{}), Status: g.Status,
		Total: g.Total, Created: g.Created, Error: g.Error, AgentCount: c[0], ActiveCount: c[1], CreatedAt: g.CreatedAt,
	}
}

// markInterrupted 生成中、但没有实例持有任务令牌的群体（执行的实例已退出，等待 job_recovery 接手）
func markInterrupted(list []dto.AIAgentGroupDto) {
	ids := make([]uint, 0)
	for _, g := range list {
		if g.Status == groupStatusGen {
			ids = append(ids, g.ID)
		}
	}
	active := groupGenerationActive(ids)
	for i := range list {
		if list[i].Status == groupStatusGen {
			list[i].Interrupted = !active[list[i].ID]
		}
	}
}

func (s *AIAgentService) ListGroups(ctx context.Context) ([]dto.AIAgentGroupDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	groups, err := repo.AIAgent.ListGroups()
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("ai_agent_group")
	}
	counts, _ := repo.AIAgent.GroupCounts()
	result := make([]dto.AIAgentGroupDto, 0, len(groups))
	for i := range groups {
		result = append(result, s.groupDto(&groups[i], counts))
	}
	markInterrupted(result)
	return result, nil
}

func (s *AIAgentService) GetGroup(ctx context.Context, id uint) (*dto.AIAgentGroupDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	g, err := repo.AIAgent.GetGroup(id)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("ai_agent_group")
	}
	counts, _ := repo.AIAgent.GroupCounts()
	list := []dto.AIAgentGroupDto{s.groupDto(g, counts)}
	markInterrupted(list)
	return &list[0], nil
}

func (s *AIAgentService) SetGroupStatus(ctx context.Context, req *dto.UpdateAIAgentGroupStatusReq) *errs.ServiceError {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return svcerr
	}
	if !(req.Status == constant.AIAgentStatusActive || req.Status == constant.AIAgentStatusPaused) {
		return errs.NewBadRequest("invalid_status")
	}
	if _, err := repo.AIAgent.GetGroup(req.ID); err != nil {
		return errs.NewNotFound("target_not_found").WithResource("ai_agent_group")
	}
	reason := ""
	if req.Status == constant.AIAgentStatusPaused {
		reason = "manual"
	}
	if err := repo.AIAgent.SetStatusByGroup(req.ID, req.Status, reason); err != nil {
		return errs.Internal("failed_to_update_target", err).WithResource("ai_agent")
	}
	return nil
}
