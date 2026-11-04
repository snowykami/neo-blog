package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
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
)

const (
	agentLeaseDuration    = 5 * time.Minute  // 租约时长，Runner 通过心跳续期
	agentLeaseTokenMaxAge = 20 * time.Minute // 租约令牌的最长有效期（心跳续期也不超过）
	agentRunsChannel      = "ai_runs"        // 新任务入队时通知其他实例唤醒长轮询
	agentRunnerSeenKey    = "ai:runner:last_seen"
	agentClaimLockKey     = "ai_runs_claim"
	agentLLMTimeout       = 3 * time.Minute
)

// ---------- 租约令牌 ----------

type agentLeaseClaims struct {
	UserID  uint  `json:"u"`
	RunID   uint  `json:"r"`
	AgentID uint  `json:"a"`
	Exp     int64 `json:"e"`
}

func agentLeaseKey() []byte {
	sum := sha256.Sum256([]byte("neo-blog/agent-lease\x00" + utils.Jwt.SigningSecret()))
	return sum[:]
}

func signAgentLease(c agentLeaseClaims) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(mustJSON(c)))
	mac := hmac.New(sha256.New, agentLeaseKey())
	mac.Write([]byte(payload))
	return constant.AgentLeaseTokenPrefix + payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func parseAgentLease(raw string) (*agentLeaseClaims, error) {
	body, ok := strings.CutPrefix(raw, constant.AgentLeaseTokenPrefix)
	if !ok {
		return nil, errors.New("not a lease token")
	}
	payload, sig, ok := strings.Cut(body, ".")
	if !ok {
		return nil, errors.New("malformed lease token")
	}
	mac := hmac.New(sha256.New, agentLeaseKey())
	mac.Write([]byte(payload))
	want := mac.Sum(nil)
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(want, got) {
		return nil, errors.New("invalid signature")
	}
	data, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, err
	}
	var c agentLeaseClaims
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, err
	}
	if time.Now().Unix() >= c.Exp {
		return nil, errors.New("lease token expired")
	}
	return &c, nil
}

// AuthenticateAgentLease 校验租约令牌：运行必须仍在租约中、AI 用户未被暂停或禁用。
// 返回挂载了用户、权限范围与运行信息的上下文；权限范围 = 运行允许的范围 ∩ 用户角色，与个人 API Token 一致
func (s *AIAgentService) AuthenticateAgentLease(ctx context.Context, raw string) (context.Context, *errs.ServiceError) {
	invalid := errs.NewUnauthorized("invalid_lease_token")
	claims, err := parseAgentLease(raw)
	if err != nil {
		return ctx, invalid
	}
	run, err := repo.AIAgent.GetRun(claims.RunID)
	now := time.Now()
	if err != nil || run.AgentID != claims.AgentID || run.Status != constant.AgentRunStatusLeased || run.LeaseUntil == nil || !run.LeaseUntil.After(now) {
		return ctx, invalid
	}
	agent, err := repo.AIAgent.GetByID(run.AgentID)
	if err != nil || agent.UserID != claims.UserID || agent.User.Disabled || !agent.User.IsAI {
		return ctx, invalid
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
	ctx = ctxutils.WithAPIToken(ctx, &ctxutils.APITokenInfo{Name: "agent-lease", Scopes: EffectiveScopes(scopes, agent.User.Role)})
	ctx = ctxutils.WithAgentRun(ctx, &ctxutils.AgentRunInfo{RunID: run.ID, AgentID: agent.ID, UserID: agent.UserID, DryRun: dryRun})
	return ctx, nil
}

// CheckRunnerToken 校验 Runner 共享密钥；未配置时 Runner 接口整体关闭
func CheckRunnerToken(raw string) *errs.ServiceError {
	want := utils.Env.Get(constant.EnvKeyAgentRunnerToken)
	if want == "" {
		return errs.NewNotFound("agent_runner_disabled")
	}
	if subtle.ConstantTimeCompare([]byte(raw), []byte(want)) != 1 {
		return errs.NewUnauthorized("invalid_runner_token")
	}
	return nil
}

// ---------- 新任务通知（长轮询唤醒） ----------

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

func runWakeChan() <-chan struct{} {
	runWakeMu.Lock()
	defer runWakeMu.Unlock()
	return runWake
}

// notifyAgentRuns 有新任务入队：唤醒本实例与其他实例上挂着的长轮询
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

// Lease 长轮询领取待办：有任务立即返回，否则最多等待 wait_seconds
func (s *AIAgentService) Lease(ctx context.Context, req *dto.AgentLeaseReq) (*dto.AgentLeaseResp, *errs.ServiceError) {
	maxRuns := clampInt(req.Max, 1, 10)
	wait := time.Duration(clampInt(req.WaitSeconds, 0, 30)) * time.Second
	deadline := time.Now().Add(wait)
	_ = sharedstate.Current().Set(agentRunnerSeenKey, strconv.FormatInt(time.Now().Unix(), 10), 10*time.Minute)
	resp := &dto.AgentLeaseResp{Site: dto.AgentLeaseSite{Name: tools.GetSiteName(), BaseURL: tools.GetBaseUrl()}, Runs: []dto.AgentLeaseRun{}}
	for {
		wake := runWakeChan()
		runs, err := s.claimRuns(ctx, maxRuns)
		if err != nil {
			logrus.Errorf("claim agent runs: %v", err)
			return nil, errs.Internal("failed_to_get_target", err).WithResource("agent_run")
		}
		resp.Runs = runs
		remaining := time.Until(deadline)
		if len(runs) > 0 || remaining <= 0 {
			return resp, nil
		}
		// 计划时间到点的任务不会触发通知，最多 5 秒重新检查一次
		timer := time.NewTimer(min(remaining, 5*time.Second))
		select {
		case <-ctx.Done():
			timer.Stop()
			return resp, nil
		case <-wake:
			timer.Stop()
		case <-timer.C:
		}
	}
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

// Heartbeat 续期租约；租约令牌本身最多有效 agentLeaseTokenMaxAge，超过后续期也无法再写入
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

// Complete Runner 回报一次运行的结果：保存操作列表、轨迹，并写入记忆
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

// ---------- LLM 网关 ----------

// llmGatewayAllowedKeys Runner 可传入的 OpenAI 兼容参数；model、key、地址由后端按配置决定
var llmGatewayAllowedKeys = []string{"messages", "tools", "tool_choice", "temperature", "response_format", "max_tokens", "parallel_tool_calls", "reasoning_effort"}

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

// LLMGateway 转发 Runner 的 chat/completions 请求：复用后台 AI 配置，按全站上限与预算限流，并把用量记到运行上
func (s *AIAgentService) LLMGateway(ctx context.Context, runID uint, body []byte) (int, []byte, *errs.ServiceError) {
	run, err := repo.AIAgent.GetRun(runID)
	if err != nil || run.Status != constant.AgentRunStatusLeased {
		return 0, nil, errs.NewNotFound("lease_not_found")
	}
	agent, err := repo.AIAgent.GetByID(run.AgentID)
	if err != nil {
		return 0, nil, errs.NewNotFound("target_not_found").WithResource("ai_agent")
	}
	aiCfg := tools.GetAIConfig()
	if !aiCfg.Configured() {
		return 0, nil, errs.NewUnavailable("ai_not_configured")
	}
	cfg := tools.GetAIAgentConfig()
	now := time.Now()
	if cfg.MonthlyTokenBudget > 0 && monthTokensCached(now) >= int64(cfg.MonthlyTokenBudget) {
		return 0, nil, errs.NewTooManyRequests("agent_token_budget_exceeded")
	}
	calls, err := sharedstate.Current().Incr(hourKey(now), 2*time.Hour)
	if err == nil && cfg.LLMCallsPerHour > 0 && calls > int64(cfg.LLMCallsPerHour) {
		return 0, nil, errs.NewTooManyRequests("agent_llm_rate_limited")
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return 0, nil, errs.NewBadRequest("invalid_request_parameters")
	}
	payload := map[string]any{"stream": false}
	for k, v := range raw {
		if slices.Contains(llmGatewayAllowedKeys, k) {
			payload[k] = v
		}
	}
	if _, ok := payload["messages"]; !ok {
		return 0, nil, errs.NewBadRequest("invalid_request_parameters")
	}
	modelName := agentModel(agent, agent.ParsedProfile(), cfg, aiCfg)
	payload["model"] = modelName

	callCtx, cancel := context.WithTimeout(ctx, agentLLMTimeout)
	defer cancel()
	resp, err := postChatCompletions(callCtx, tools.AIConfig{BaseURL: aiCfg.BaseURL, APIKey: aiCfg.APIKey, Model: modelName}, payload)
	var statusErr *chatStatusError
	if errors.As(err, &statusErr) {
		// 上游的错误原样转给 Runner，便于它判断是否重试（不含密钥等内部信息）
		return statusErr.code, []byte(mustJSON(map[string]any{"error": map[string]any{"message": statusErr.msg}})), nil
	}
	if err != nil {
		return http.StatusBadGateway, []byte(mustJSON(map[string]any{"error": map[string]any{"message": err.Error()}})), nil
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return http.StatusBadGateway, []byte(mustJSON(map[string]any{"error": map[string]any{"message": err.Error()}})), nil
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
	return http.StatusOK, data, nil
}

// ---------- 构建租约内容 ----------

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
		LeaseToken: signAgentLease(agentLeaseClaims{
			UserID: agent.UserID, RunID: run.ID, AgentID: agent.ID, Exp: now.Add(agentLeaseTokenMaxAge).Unix(),
		}),
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
