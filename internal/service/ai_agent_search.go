package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

// AI 用户的查找与按用户名读取：供 MCP 工具与人物蒸馏 skill 判断平台上是否已有同一个人的 AI 用户，有就更新而不是重复新建

const (
	aiAgentFindMaxKeywords   = 10
	aiAgentFindMaxKeywordLen = 64
	aiAgentFindDefaultLimit  = 10
	aiAgentFindMaxLimit      = 20
	aiAgentFindScanLimit     = 200 // 先取出的候选数，打分排序后再截取
	aiAgentRecentCommentsN   = 8
)

// 各匹配方式的分值：用户名完全一致最可信，其次是昵称，再次是用户名或昵称包含、原型与人设里提到
var aiAgentMatchScores = map[string]int{
	"username": 100, "nickname": 80, "username_partial": 40, "nickname_partial": 30, "archetype": 20, "persona": 15, "profile": 5,
}

// FindAIAgents 按名字或关键词（真名、网名、ID、角色名等）查找可能是同一个人的 AI 用户，最像的排在前面
func (s *AIAgentService) FindAIAgents(ctx context.Context, keywords []string, limit int) (*dto.AIAgentMatchResult, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	words := make([]string, 0, len(keywords))
	for _, keyword := range keywords {
		word := strings.ToLower(strings.TrimSpace(keyword))
		if word != "" && utf8.RuneCountInString(word) <= aiAgentFindMaxKeywordLen && !slices.Contains(words, word) {
			words = append(words, word)
		}
	}
	if len(words) == 0 || len(words) > aiAgentFindMaxKeywords {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	if limit <= 0 {
		limit = aiAgentFindDefaultLimit
	}
	limit = min(limit, aiAgentFindMaxLimit)

	agents, err := repo.AIAgent.SearchAgents(words, aiAgentFindScanLimit)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("ai_agent")
	}
	type scored struct {
		match dto.AIAgentMatchDto
		score int
	}
	list := make([]scored, 0, len(agents))
	for i := range agents {
		agent := &agents[i]
		matchedBy := aiAgentMatchReasons(agent, words)
		score := 0
		for _, reason := range matchedBy {
			score += aiAgentMatchScores[reason]
		}
		list = append(list, scored{score: score, match: dto.AIAgentMatchDto{
			ID: agent.ID, Username: agent.User.Username, Nickname: agent.User.Nickname, Tier: agent.Tier, Status: agent.Status,
			Archetype: agent.ParsedProfile().Archetype, MatchedBy: matchedBy, LastActiveAt: agent.LastActiveAt,
		}})
	}
	slices.SortStableFunc(list, func(a, b scored) int { return b.score - a.score })
	result := &dto.AIAgentMatchResult{Matches: make([]dto.AIAgentMatchDto, 0, min(limit, len(list))), TakenUsernames: []string{}}
	for i := 0; i < len(list) && i < limit; i++ {
		result.Matches = append(result.Matches, list[i].match)
	}
	// 关键词恰好是普通用户的用户名时，这个用户名不能用来导入 AI 用户
	for _, word := range words {
		user, err := repo.User.GetUserByUsername(word)
		if err == nil && !user.IsAI {
			result.TakenUsernames = append(result.TakenUsernames, user.Username)
		}
	}
	return result, nil
}

// aiAgentMatchReasons 这个 AI 用户与哪些关键词、以什么方式匹配（每种方式只记一次）
func aiAgentMatchReasons(agent *model.AIAgent, words []string) []string {
	profile := agent.ParsedProfile()
	username, nickname := strings.ToLower(agent.User.Username), strings.ToLower(agent.User.Nickname)
	archetype, persona := strings.ToLower(profile.Archetype), strings.ToLower(profile.Persona)
	reasons := []string{}
	add := func(reason string) {
		if !slices.Contains(reasons, reason) {
			reasons = append(reasons, reason)
		}
	}
	for _, word := range words {
		switch {
		case username == word:
			add("username")
		case strings.Contains(username, word):
			add("username_partial")
		}
		switch {
		case nickname == word:
			add("nickname")
		case strings.Contains(nickname, word):
			add("nickname_partial")
		}
		if strings.Contains(archetype, word) {
			add("archetype")
		}
		if strings.Contains(persona, word) {
			add("persona")
		}
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "profile") // 只在兴趣、示例评论等其他字段里出现
	}
	return reasons
}

// GetAIAgentFile 按用户名读取 AI 用户：与导入文件相同格式的资料与性格档案（可直接修改后再导入），以及状态和最近发过的评论
func (s *AIAgentService) GetAIAgentFile(ctx context.Context, username string) (*dto.AIAgentFileDetail, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	user, err := repo.User.GetUserByUsername(strings.TrimSpace(username))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("ai_agent")
		}
		return nil, errs.Internal("failed_to_get_target", err).WithResource("user")
	}
	agent, err := repo.AIAgent.GetByUserID(user.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("ai_agent")
		}
		return nil, errs.Internal("failed_to_get_target", err).WithResource("ai_agent")
	}
	items, svcerr := s.Export(ctx, &dto.ExportAIAgentsReq{ID: agent.ID})
	if svcerr != nil {
		return nil, svcerr
	}
	comments, err := repo.AIAgent.RecentUserComments(user.ID, aiAgentRecentCommentsN)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("comment")
	}
	return &dto.AIAgentFileDetail{
		ID: agent.ID, Status: agent.Status, PausedReason: agent.PausedReason, CreatedAt: agent.CreatedAt, LastActiveAt: agent.LastActiveAt,
		Agent: items[0], RecentComments: append([]string{}, comments...),
	}, nil
}
