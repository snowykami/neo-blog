package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
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

// AI 用户的任务由各实例上的 worker（见 internal/agentrunner）执行：
// 待办存在数据库 agent_runs；领取在全局锁内用条件更新抢占，同一任务只会被一个实例领到；
// 新任务入队时经 sharedstate 通知各实例唤醒（单实例为进程内存，多副本为 Redis）

const (
	agentLeaseDuration = 5 * time.Minute // 租约时长，worker 通过心跳续期；实例中途退出时到期后重新入队
	// AgentRunMaxDuration 一次运行的最长时间：worker 到时中止，按运行计数的键以此为过期时间
	AgentRunMaxDuration = 15 * time.Minute
	agentRunsChannel    = "ai_runs" // 新任务入队时通知其他实例唤醒 worker
	agentRunnerSeenKey  = "ai:runner:last_seen"
	agentClaimLockKey   = "ai_runs_claim"
	agentLLMTimeout     = 3 * time.Minute
)

// ---------- 运行上下文 ----------

// AgentRunContext 以某次运行的 AI 用户身份执行工具时的上下文：运行必须仍在租约中、AI 用户未被暂停或禁用，每次调用工具前确认。
// 返回挂载了用户、权限范围与运行信息的上下文；权限范围 = 运行允许的范围 ∩ 用户角色，与个人 API Token 一致，试运行只有读权限
func (s *AIAgentService) AgentRunContext(ctx context.Context, runID uint) (context.Context, *errs.ServiceError) {
	notLeased := errs.NewNotFound("lease_not_found")
	run, err := repo.AIAgent.GetRun(runID)
	if err != nil || run.Status != constant.AgentRunStatusLeased || run.LeaseUntil == nil || !run.LeaseUntil.After(time.Now()) {
		return ctx, notLeased
	}
	agent, err := repo.AIAgent.GetByID(run.AgentID)
	if err != nil || agent.User.Disabled || !agent.User.IsAI {
		return ctx, notLeased
	}
	dryRun := run.Kind == constant.AgentRunKindDryRun
	if !dryRun && (agent.Status != constant.AIAgentStatusActive || !tools.GetAIAgentConfig().Enabled) {
		return ctx, errs.NewForbidden("ai_agent_paused")
	}
	scopes := []string{constant.ScopePostsRead}
	if !dryRun {
		scopes = append(scopes, constant.ScopeCommentsWrite, constant.ScopeLikesWrite)
		profile := agent.ParsedProfile()
		if tools.GetAIAgentConfig().ProfileSelfEdit && profile.SelfEdit.Enabled && len(profile.SelfEdit.Fields) > 0 {
			scopes = append(scopes, constant.ScopeProfileWrite)
		}
	}
	ctx = context.WithValue(ctx, "user_id", agent.UserID)
	ctx = ctxutils.WithUserCache(ctx)
	ctx = ctxutils.WithAPIToken(ctx, &ctxutils.APITokenInfo{Name: "ai-agent", Scopes: EffectiveScopes(scopes, agent.User.Role)})
	ctx = ctxutils.WithAgentRun(ctx, &ctxutils.AgentRunInfo{RunID: run.ID, AgentID: agent.ID, UserID: agent.UserID, DryRun: dryRun})
	return ctx, nil
}

// ---------- 新任务通知（唤醒 worker） ----------

var (
	runWakeMu sync.Mutex
	runWake   = make(chan struct{})
	listenMu  sync.Once
)

func wakeLocalRunners() {
	runWakeMu.Lock()
	close(runWake)
	runWake = make(chan struct{})
	runWakeMu.Unlock()
}

// AgentRunWake 新任务入队时关闭的通道：worker 空闲时在上面等待，每次等待前重新获取
func AgentRunWake() <-chan struct{} {
	runWakeMu.Lock()
	defer runWakeMu.Unlock()
	return runWake
}

// notifyAgentRuns 有新任务入队：唤醒本实例与其他实例上空闲的 worker
// ReleaseRun 实例退出前放弃尚未完成的任务：立即重新排队并退回这次领取计入的尝试次数，其他实例可以马上接着执行，不必等租约到期。
// 已执行过的写操作不会重复：同一次运行对同一目标只发一条评论、写操作总数受限，这两项计数都在共享状态中
func (s *AIAgentService) ReleaseRun(runID uint) {
	ok, err := repo.AIAgent.UpdateRunIf(runID, constant.AgentRunStatusLeased, map[string]any{
		"status":      constant.AgentRunStatusQueued,
		"lease_until": nil,
		"attempts":    gorm.Expr("attempts - 1"),
	})
	if err != nil {
		logrus.Warnf("release agent run %d: %v", runID, err)
		return
	}
	if ok {
		logrus.Infof("released unfinished agent run %d for other instances", runID)
		notifyAgentRuns()
	}
}

func notifyAgentRuns() {
	wakeLocalRunners()
	sharedstate.Notify(agentRunsChannel, "new")
}

// ListenAgentRuns 订阅其他实例的新任务通知，启动时调用一次
func ListenAgentRuns() {
	listenMu.Do(func() {
		sharedstate.OnNotify(agentRunsChannel, func(string) { wakeLocalRunners() })
	})
}

// ---------- 领取、心跳、回报 ----------

// AgentSite 站点信息（写进系统提示词）
func (s *AIAgentService) AgentSite() dto.AgentLeaseSite {
	return dto.AgentLeaseSite{Name: tools.GetSiteName(), BaseURL: tools.GetBaseUrl()}
}

// MarkAgentWorkersOnline 记录有实例的 worker 在运行（后台总览据此显示在线状态），worker 每次检查任务时调用
func MarkAgentWorkersOnline() {
	_ = sharedstate.Current().Set(agentRunnerSeenKey, strconv.FormatInt(time.Now().Unix(), 10), 10*time.Minute)
}

// ClaimRuns 领取最多 maxRuns 个到点的任务，没有时返回空
func (s *AIAgentService) ClaimRuns(ctx context.Context, maxRuns int) ([]dto.AgentLeaseRun, error) {
	return s.claimRuns(ctx, clampInt(maxRuns, 1, 10))
}

// claimRuns 在全局锁内领取任务：同一 AI 同时只有一个任务在执行
func (s *AIAgentService) claimRuns(ctx context.Context, maxRuns int) ([]dto.AgentLeaseRun, error) {
	lockCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	release, err := sharedstate.Lock(lockCtx, agentClaimLockKey, 10*time.Second)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return nil, nil
		}
		return nil, err
	}
	defer release()

	now := time.Now()
	if err := repo.AIAgent.RequeueExpired(now, agentRunMaxAttempts); err != nil {
		return nil, err
	}
	due, err := repo.AIAgent.DueRuns(now, maxRuns*10)
	if err != nil {
		return nil, err
	}
	busy, err := repo.AIAgent.LeasedAgentIDs(now)
	if err != nil {
		return nil, err
	}
	cfg := tools.GetAIAgentConfig()
	agents := map[uint]*model.AIAgent{}
	result := make([]dto.AgentLeaseRun, 0, maxRuns)
	for i := range due {
		if len(result) >= maxRuns {
			break
		}
		run := &due[i]
		if busy[run.AgentID] {
			continue
		}
		agent, ok := agents[run.AgentID]
		if !ok {
			if agent, err = repo.AIAgent.GetByID(run.AgentID); err != nil {
				_, _ = repo.AIAgent.UpdateRunIf(run.ID, constant.AgentRunStatusQueued, map[string]any{"status": constant.AgentRunStatusFailed, "error": "agent not found", "finished_at": now})
				continue
			}
			agents[run.AgentID] = agent
		}
		if run.Kind != constant.AgentRunKindDryRun {
			reason := ""
			switch {
			case !cfg.Enabled:
				reason = "disabled"
			case agent.Status != constant.AIAgentStatusActive:
				reason = "agent_paused"
			case agent.User.Disabled:
				reason = "user_disabled"
			}
			if reason != "" {
				_, _ = repo.AIAgent.UpdateRunIf(run.ID, constant.AgentRunStatusQueued, map[string]any{"status": constant.AgentRunStatusSkipped, "skip_reason": reason, "finished_at": now})
				continue
			}
		}
		leaseUntil := now.Add(agentLeaseDuration)
		ok, err = repo.AIAgent.UpdateRunIf(run.ID, constant.AgentRunStatusQueued, map[string]any{
			"status":      constant.AgentRunStatusLeased,
			"lease_until": leaseUntil,
			"attempts":    run.Attempts + 1,
		})
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		run.Attempts++
		leased, err := s.buildLeaseRun(run, agent, cfg, now, leaseUntil)
		if err != nil {
			logrus.Errorf("build lease for run %d: %v", run.ID, err)
			_ = repo.AIAgent.UpdateRun(run.ID, map[string]any{"status": constant.AgentRunStatusFailed, "error": err.Error(), "finished_at": now})
			continue
		}
		busy[run.AgentID] = true
		result = append(result, *leased)
	}
	return result, nil
}

// Heartbeat 续期租约
func (s *AIAgentService) Heartbeat(ctx context.Context, runID uint) (*time.Time, *errs.ServiceError) {
	run, err := repo.AIAgent.GetRun(runID)
	if err != nil || run.Status != constant.AgentRunStatusLeased {
		return nil, errs.NewNotFound("lease_not_found")
	}
	until := time.Now().Add(agentLeaseDuration)
	if ok, err := repo.AIAgent.UpdateRunIf(run.ID, constant.AgentRunStatusLeased, map[string]any{"lease_until": until}); err != nil || !ok {
		return nil, errs.NewNotFound("lease_not_found")
	}
	return &until, nil
}

// Complete 回报一次运行的结果：保存操作列表、轨迹，并写入记忆
func (s *AIAgentService) Complete(ctx context.Context, req *dto.AgentCompleteReq) *errs.ServiceError {
	run, err := repo.AIAgent.GetRun(req.ID)
	if err != nil || run.Status != constant.AgentRunStatusLeased {
		return errs.NewNotFound("lease_not_found")
	}
	status := constant.AgentRunStatusDone
	if req.Status == constant.AgentRunStatusFailed {
		status = constant.AgentRunStatusFailed
	}
	if len(req.Actions) > agentMaxActionsPerRun*2 {
		req.Actions = req.Actions[:agentMaxActionsPerRun*2]
	}
	for i := range req.Actions {
		a := &req.Actions[i]
		a.Content = clipRunes(a.Content, 500)
		a.Detail = clipRunes(a.Detail, 300)
	}
	if len(req.Trace) > 60 {
		req.Trace = req.Trace[:60]
	}
	for i := range req.Trace {
		req.Trace[i].Step = clipRunes(req.Trace[i].Step, 40)
		req.Trace[i].Detail = clipRunes(req.Trace[i].Detail, 600)
	}
	note := sanitizeMemoryNote(req.MemoryNote)
	now := time.Now()
	ok, err := repo.AIAgent.UpdateRunIf(run.ID, constant.AgentRunStatusLeased, map[string]any{
		"status":      status,
		"actions":     mustJSON(req.Actions),
		"reason":      clipRunes(req.Reason, 300),
		"memory_note": note,
		"trace":       mustJSON(req.Trace),
		"error":       clipRunes(req.Error, 1000),
		"finished_at": now,
		"lease_until": nil,
	})
	if err != nil {
		return errs.Internal("failed_to_update_target", err).WithResource("agent_run")
	}
	if !ok {
		return errs.NewNotFound("lease_not_found")
	}
	if run.Kind == constant.AgentRunKindDryRun {
		return nil
	}
	_ = repo.AIAgent.UpdateColumns(run.AgentID, map[string]any{"last_active_at": now})
	if status == constant.AgentRunStatusDone {
		run, err = repo.AIAgent.GetRun(run.ID)
		if err == nil {
			if err := s.recordRunMemory(run, note, now); err != nil {
				logrus.Warnf("record memory for run %d: %v", run.ID, err)
			}
		}
	}
	return nil
}

// ---------- 调用模型 ----------

// ErrAgentLLMBudget 全站模型调用频率或 token 预算已到上限，本次运行不再重试
var ErrAgentLLMBudget = errors.New("agent llm budget or rate limit reached")

// AgentLLMStatusError 模型接口返回的错误状态（不含密钥等内部信息）
type AgentLLMStatusError struct {
	Status  int
	Message string
}

func (e *AgentLLMStatusError) Error() string {
	return fmt.Sprintf("llm status %d: %s", e.Status, e.Message)
}

func hourKey(now time.Time) string {
	return "ai:llm:h:" + now.Format("2006010215")
}

func hourLLMCalls(now time.Time) int64 {
	v, ok, err := sharedstate.Current().Get(hourKey(now))
	if err != nil || !ok {
		return 0
	}
	n, _ := strconv.ParseInt(v, 10, 64)
	return n
}

// monthTokensCached 本月已用 token：从运行记录汇总，缓存 30 秒
func monthTokensCached(now time.Time) int64 {
	key := "ai:tokens:m:" + now.Format("200601")
	if v, ok, _ := sharedstate.Current().Get(key); ok {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	n, err := repo.AIAgent.SumTokens(monthStart(now))
	if err != nil {
		return 0
	}
	_ = sharedstate.Current().Set(key, strconv.FormatInt(n, 10), 30*time.Second)
	return n
}

// AgentChat 以某次运行的名义调用模型（OpenAI 兼容的 chat/completions）：复用后台 AI 配置，
// 按全站上限与预算限流，并把用量记到运行上；返回上游的原始响应体
func (s *AIAgentService) AgentChat(ctx context.Context, runID uint, payload map[string]any) ([]byte, error) {
	run, err := repo.AIAgent.GetRun(runID)
	if err != nil || run.Status != constant.AgentRunStatusLeased {
		return nil, errs.NewNotFound("lease_not_found")
	}
	agent, err := repo.AIAgent.GetByID(run.AgentID)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("ai_agent")
	}
	aiCfg := tools.GetAIConfig()
	if !aiCfg.Configured() {
		return nil, errs.NewUnavailable("ai_not_configured")
	}
	cfg := tools.GetAIAgentConfig()
	now := time.Now()
	if cfg.MonthlyTokenBudget > 0 && monthTokensCached(now) >= int64(cfg.MonthlyTokenBudget) {
		return nil, fmt.Errorf("%w: monthly token budget", ErrAgentLLMBudget)
	}
	calls, err := sharedstate.Current().Incr(hourKey(now), 2*time.Hour)
	if err == nil && cfg.LLMCallsPerHour > 0 && calls > int64(cfg.LLMCallsPerHour) {
		return nil, fmt.Errorf("%w: hourly call limit", ErrAgentLLMBudget)
	}
	modelName := agentModel(agent, agent.ParsedProfile(), cfg, aiCfg)
	body := map[string]any{"stream": false}
	for k, v := range payload {
		body[k] = v
	}
	body["model"] = modelName

	callCtx, cancel := context.WithTimeout(ctx, agentLLMTimeout)
	defer cancel()
	resp, err := postChatCompletions(callCtx, tools.AIConfig{BaseURL: aiCfg.BaseURL, APIKey: aiCfg.APIKey, Model: modelName}, body)
	var statusErr *chatStatusError
	if errors.As(err, &statusErr) {
		return nil, &AgentLLMStatusError{Status: statusErr.code, Message: statusErr.msg}
	}
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	var usage struct {
		Usage struct {
			PromptTokens        int `json:"prompt_tokens"`
			CompletionTokens    int `json:"completion_tokens"`
			PromptTokensDetails struct {
				CachedTokens int `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
			PromptCacheHitTokens int `json:"prompt_cache_hit_tokens"` // DeepSeek 等的写法
		} `json:"usage"`
	}
	_ = json.Unmarshal(data, &usage)
	cached := max(usage.Usage.PromptTokensDetails.CachedTokens, usage.Usage.PromptCacheHitTokens)
	if err := repo.AIAgent.AddRunUsage(run.ID, modelName, usage.Usage.PromptTokens, cached, usage.Usage.CompletionTokens); err != nil {
		logrus.Warnf("record llm usage for run %d: %v", run.ID, err)
	}
	return data, nil
}

// ---------- 构建运行内容 ----------

func postRef(p *model.Post, baseURL string) dto.AgentPostRef {
	labels := make([]string, 0, len(p.Labels))
	for _, l := range p.Labels {
		labels = append(labels, l.Name)
	}
	ref := dto.AgentPostRef{
		ID:           p.ID,
		Title:        p.Title,
		Summary:      clipRunes(utils.Ternary(p.AISummary != "", p.AISummary, p.Description), 300),
		Labels:       labels,
		Author:       displayName(&p.User),
		AuthorID:     p.UserID,
		CreatedAt:    p.CreatedAt,
		CommentCount: p.CommentCount,
		LikeCount:    p.LikeCount,
	}
	if p.Category != nil {
		ref.Category = p.Category.Name
	}
	slug := strconv.FormatUint(uint64(p.ID), 10)
	if p.Slug != nil && *p.Slug != "" {
		slug = *p.Slug
	}
	ref.URL = baseURL + "/p/" + slug
	return ref
}

func (s *AIAgentService) buildLeaseRun(run *model.AgentRun, agent *model.AIAgent, cfg tools.AIAgentConfig, now, leaseUntil time.Time) (*dto.AgentLeaseRun, error) {
	profile := agent.ParsedProfile()
	baseURL := tools.GetBaseUrl()
	dryRun := run.Kind == constant.AgentRunKindDryRun
	leased := &dto.AgentLeaseRun{
		RunID:          run.ID,
		Kind:           run.Kind,
		Trigger:        run.Trigger,
		DryRun:         dryRun,
		LeaseExpiresAt: leaseUntil,
		Agent: dto.AgentLeaseAgent{
			UserID: agent.UserID, Username: agent.User.Username, Nickname: agent.User.Nickname, AvatarUrl: agent.User.AvatarUrl,
			Tier: agent.Tier, Profile: profile, SelfSummary: agent.SelfSummary,
		},
		Feed:         []dto.AgentPostRef{},
		SelfEditHint: profile.SelfEdit.Hint,
		CanSelfEdit:  !dryRun && cfg.ProfileSelfEdit && profile.SelfEdit.Enabled && len(profile.SelfEdit.Fields) > 0,
	}
	if agent.Tier == constant.AIAgentTierExpert {
		leased.MaxSteps = agentExpertMaxSteps
	}
	// 自己最近说过的话：提示词要求不重复开头、句式和观点，避免每条评论一个腔调
	if recent, err := repo.AIAgent.RecentUserComments(agent.UserID, agentRecentComments); err == nil {
		for _, content := range recent {
			leased.RecentComments = append(leased.RecentComments, clipRunes(content, 80))
		}
	}

	relatedUsers := []uint{}
	keywords := slices.Clone(profile.Interests)
	// 事件详情
	switch run.TargetType {
	case constant.TargetTypePost:
		posts, err := repo.AIAgent.PostsByIDs([]uint{run.TargetID})
		if err != nil {
			return nil, err
		}
		if len(posts) == 0 {
			return nil, errors.New("target post not found")
		}
		ref := postRef(&posts[0], baseURL)
		leased.Event = &dto.AgentLeaseEvent{TargetType: constant.TargetTypePost, TargetID: run.TargetID, Post: &ref}
		relatedUsers = append(relatedUsers, ref.AuthorID)
		keywords = append(keywords, ref.Labels...)
	case constant.TargetTypeComment:
		c, err := repo.Comment.GetComment(run.TargetID)
		if err != nil {
			return nil, fmt.Errorf("target comment not found: %w", err)
		}
		ref := &dto.AgentCommentRef{
			ID: c.ID, Content: c.Content, AuthorID: c.UserID, AuthorName: displayName(&c.User),
			TargetType: c.TargetType, TargetID: c.TargetID, ReplyID: c.ReplyID, RootID: c.RootID,
		}
		if c.ReplyID != 0 {
			if parent, err := repo.Comment.GetComment(c.ReplyID); err == nil {
				ref.ReplyToContent = parent.Content
			}
		}
		event := &dto.AgentLeaseEvent{TargetType: constant.TargetTypeComment, TargetID: c.ID, Comment: ref, AIDepth: aiChainDepth(c.ID)}
		if c.TargetType == constant.TargetTypePost {
			if posts, err := repo.AIAgent.PostsByIDs([]uint{c.TargetID}); err == nil && len(posts) > 0 {
				p := postRef(&posts[0], baseURL)
				event.Post = &p
				keywords = append(keywords, p.Labels...)
			}
		}
		leased.Event = event
		relatedUsers = append(relatedUsers, c.UserID)
	}

	// 推荐流
	feedIDs := parseJSONOr(run.Feed, []uint{})
	if len(feedIDs) > 0 {
		posts, err := repo.AIAgent.PostsByIDs(feedIDs)
		if err != nil {
			return nil, err
		}
		commented, liked, _ := repo.AIAgent.UserPostInteractions(agent.UserID, feedIDs)
		byID := map[uint]*model.Post{}
		for i := range posts {
			byID[posts[i].ID] = &posts[i]
		}
		for _, id := range feedIDs {
			if p, ok := byID[id]; ok && !p.IsPrivate {
				ref := postRef(p, baseURL)
				ref.Commented, ref.Liked = commented[id], liked[id]
				leased.Feed = append(leased.Feed, ref)
				relatedUsers = append(relatedUsers, p.UserID)
			}
		}
	}
	if leased.Event != nil && leased.Event.Post != nil {
		commented, liked, _ := repo.AIAgent.UserPostInteractions(agent.UserID, []uint{leased.Event.Post.ID})
		leased.Event.Post.Commented, leased.Event.Post.Liked = commented[leased.Event.Post.ID], liked[leased.Event.Post.ID]
	}

	leased.Memories = s.retrieveMemories(agent, profile, relatedUsers, keywords, now)
	today := dayStart(now)
	leased.Quota.CommentsToday, _ = repo.AIAgent.CountUserComments(agent.UserID, today)
	leased.Quota.LikesToday, _ = repo.AIAgent.CountUserLikes(agent.UserID, today)
	leased.Quota.CommentsLimit = profile.Limits.CommentsPerDay
	leased.Quota.LikesLimit = profile.Limits.LikesPerDay
	leased.Quota.MaxActions = agentMaxActionsPerRun
	return leased, nil
}
