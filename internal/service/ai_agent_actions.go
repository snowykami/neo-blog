package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"  // 注册 GIF 解码，用于读取头像尺寸
	_ "image/jpeg" // 注册 JPEG 解码
	_ "image/png"  // 注册 PNG 解码
	"net/http"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/config"
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

// AgentGuard：AI 用户的每个写操作在进入与普通用户相同的 service 之前，先经过这里的额外限制。
// 提示词只是让模型少犯错，真正的限制全部在这里

var reAgentLink = regexp.MustCompile(`(?i)(https?://|www\.)\S+`)

// agentWriteContext 当前请求所属的运行与 AI 用户
type agentWriteContext struct {
	run     *ctxutils.AgentRunInfo
	agent   *model.AIAgent
	profile dto.AIAgentProfile
	cfg     tools.AIAgentConfig
	now     time.Time
}

func loadAgentWriteContext(ctx context.Context, scope string) (*agentWriteContext, *errs.ServiceError) {
	run, ok := ctxutils.GetAgentRun(ctx)
	if !ok {
		return nil, errs.NewForbidden("agent_lease_required")
	}
	if !ctxutils.HasAPITokenScope(ctx, scope) {
		return nil, errs.NewForbidden("api_token_scope_insufficient")
	}
	agent, err := repo.AIAgent.GetByID(run.AgentID)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found").WithResource("ai_agent")
	}
	return &agentWriteContext{run: run, agent: agent, profile: agent.ParsedProfile(), cfg: tools.GetAIAgentConfig(), now: time.Now()}, nil
}

// takeWriteSlot 每次运行最多 agentMaxActionsPerRun 次写操作（共享状态出错时按本机计数）
func (w *agentWriteContext) takeWriteSlot() *errs.ServiceError {
	if utils.IncrCounter(fmt.Sprintf("ai:run:%d:writes", w.run.RunID), AgentRunMaxDuration+agentLeaseDuration) > agentMaxActionsPerRun {
		return errs.NewTooManyRequests("agent_run_action_limit")
	}
	return nil
}

// recordEffect 把实际写入追加到运行记录，撤回时据此回滚
// 写入已经发生，记录失败时只打日志（撤回时会缺这一项，需要人工处理）
func recordEffect(runID uint, effect dto.AgentEffectDto) {
	run, err := repo.AIAgent.GetRun(runID)
	if err != nil {
		logrus.Warnf("record effect of agent run %d (%s): load run: %v", runID, effect.Type, err)
		return
	}
	effects := parseJSONOr(run.Effects, []dto.AgentEffectDto{})
	effects = append(effects, effect)
	if err := repo.AIAgent.UpdateRun(runID, map[string]any{"effects": mustJSON(effects)}); err != nil {
		logrus.Warnf("record effect of agent run %d (%s): %v", runID, effect.Type, err)
	}
}

// aiChainDepth 评论所在回复链的 AI 互动深度：从这条评论开始向上，连续的 AI 评论条数（遇到真人即停）
func aiChainDepth(commentID uint) int {
	depth := 0
	for i := 0; i < 12 && commentID != 0; i++ {
		c, err := repo.Comment.GetComment(commentID)
		if err != nil || !c.User.IsAI {
			break
		}
		depth++
		commentID = c.ReplyID
	}
	return depth
}

// bigramSimilarity 两段文字的字符二元组 Jaccard 相似度
func bigramSimilarity(a, b string) float64 {
	grams := func(s string) map[string]bool {
		r := []rune(strings.ToLower(strings.Join(strings.Fields(s), "")))
		set := map[string]bool{}
		for i := 0; i+1 < len(r); i++ {
			set[string(r[i:i+2])] = true
		}
		return set
	}
	ga, gb := grams(a), grams(b)
	if len(ga) == 0 || len(gb) == 0 {
		return 0
	}
	inter := 0
	for g := range ga {
		if gb[g] {
			inter++
		}
	}
	return float64(inter) / float64(len(ga)+len(gb)-inter)
}

func containsBlockedTopic(content string, topics []string) bool {
	lower := strings.ToLower(content)
	for _, t := range topics {
		if t != "" && strings.Contains(lower, strings.ToLower(t)) {
			return true
		}
	}
	return false
}

// checkComment 评论前的全部额外检查
func (w *agentWriteContext) checkComment(targetType string, targetID, replyID uint, content string) *errs.ServiceError {
	if reAgentLink.MatchString(content) {
		return errs.NewForbidden("agent_comment_link_not_allowed")
	}
	if containsBlockedTopic(content, w.profile.BlockedTopics) {
		return errs.NewForbidden("agent_comment_blocked_topic")
	}
	today := dayStart(w.now)
	userID := w.agent.UserID
	if n, _ := repo.AIAgent.CountUserComments(userID, today); n >= int64(w.profile.Limits.CommentsPerDay) {
		return errs.NewTooManyRequests("agent_daily_comment_limit")
	}
	if w.profile.Limits.CooldownMinutes > 0 {
		if last, _ := repo.AIAgent.LastCommentAt(userID); last != nil && w.now.Sub(*last) < time.Duration(w.profile.Limits.CooldownMinutes)*time.Minute {
			return errs.NewTooManyRequests("agent_comment_cooldown")
		}
	}
	if n, _ := repo.AIAgent.CountAIComments(today); n >= int64(w.cfg.CommentsPerDay) {
		return errs.NewTooManyRequests("agent_global_comment_limit")
	}
	var parent *model.Comment
	if replyID != 0 {
		var err error
		if parent, err = repo.Comment.GetComment(replyID); err != nil {
			return errs.NewNotFound("operation_target_not_found").WithResource("comment")
		}
	}
	if parent != nil && !parent.User.IsAI {
		// 回复真人单独计数：每条真人评论最多被 AI 直接回复几次，不占单篇的 AI 评论名额（单篇满了也能回应真人）
		if n, _ := repo.AIAgent.CountAIRepliesTo(parent.ID); n >= int64(w.cfg.RepliesPerHuman) {
			return errs.NewTooManyRequests("agent_human_reply_limit")
		}
	} else {
		// 单篇上限：AI 的顶层评论与 AI 之间的回复合计 ≤ max(基数, 真人评论数 × 比例)
		aiCount, humanCount, _ := repo.AIAgent.CountTargetComments(targetType, targetID)
		postCap := max(int64(w.cfg.CommentsPerPost), int64(float64(humanCount)*w.cfg.AIRatio))
		if aiCount >= postCap {
			return errs.NewTooManyRequests("agent_post_comment_limit")
		}
	}
	// 每个 AI 在同一篇下的顶层评论不超过个体上限（回复不计）
	if replyID == 0 {
		if n, _ := repo.AIAgent.CountUserRootCommentsOnTarget(userID, targetType, targetID); n >= int64(w.profile.Limits.CommentsPerPost) {
			return errs.NewTooManyRequests("agent_post_comment_limit")
		}
	}
	if parent != nil {
		if parent.UserID == userID {
			return errs.NewForbidden("agent_cannot_reply_self")
		}
		// AI 互动深度：回复后的深度不能超过上限
		if aiChainDepth(replyID)+1 > w.cfg.MaxChainDepth {
			return errs.NewForbidden("agent_chain_depth_exceeded")
		}
		if parent.User.IsAI {
			if !w.profile.AIInteraction.Enabled {
				return errs.NewForbidden("agent_ai_interaction_disabled")
			}
			rootID := utils.Ternary(parent.RootID != 0, parent.RootID, parent.ID)
			if n, _ := repo.AIAgent.CountPairReplies(userID, parent.UserID, rootID, today); n >= int64(w.cfg.PairExchanges) {
				return errs.NewTooManyRequests("agent_pair_exchange_limit")
			}
		}
	}
	recent, _ := repo.AIAgent.RecentTargetComments(targetType, targetID, 50)
	for _, c := range recent {
		if bigramSimilarity(c, content) >= 0.6 {
			return errs.NewConflict("agent_comment_too_similar")
		}
	}
	return nil
}

// AgentCreateComment AI 用户发表评论 / 回复
func (s *AIAgentService) AgentCreateComment(ctx context.Context, targetType string, targetID, replyID uint, content string) (uint, *errs.ServiceError) {
	w, svcerr := loadAgentWriteContext(ctx, constant.ScopeCommentsWrite)
	if svcerr != nil {
		return 0, svcerr
	}
	content = strings.TrimSpace(content)
	if content == "" {
		return 0, errs.NewBadRequest("content_cannot_be_empty")
	}
	// 回复时以被回复评论所在的文章 / 页面为目标
	if replyID != 0 {
		parent, err := repo.Comment.GetComment(replyID)
		if err != nil {
			return 0, errs.NewNotFound("operation_target_not_found").WithResource("comment")
		}
		targetType, targetID = parent.TargetType, parent.TargetID
	}
	if !(targetType == constant.TargetTypePost || targetType == constant.TargetTypePage) {
		return 0, errs.NewBadRequest("invalid_target_type")
	}
	slotKey := fmt.Sprintf("ai:run:%d:comment:%s:%d:%d", w.run.RunID, targetType, targetID, replyID)
	if ok, err := sharedstate.Current().SetNX(slotKey, "1", AgentRunMaxDuration+agentLeaseDuration); err == nil && !ok {
		return 0, errs.NewConflict("agent_duplicate_comment_in_run")
	}
	// 全站、单篇、单个 AI 的评论上限都是「先数再写」：检查与写入放在同一把锁里，多个 AI（多个实例）同时评论也不会超出
	release, err := sharedstate.Lock(ctx, agentCommentLockKey, agentCommentLockTTL)
	if err != nil {
		_ = sharedstate.Current().Delete(slotKey)
		return 0, errs.NewTooManyRequests("agent_comment_busy")
	}
	commentID, svcerr := w.createCommentLocked(ctx, targetType, targetID, replyID, content)
	release()
	if svcerr != nil {
		_ = sharedstate.Current().Delete(slotKey)
		return 0, svcerr
	}
	recordEffect(w.run.RunID, dto.AgentEffectDto{Type: "comment", CommentID: commentID, TargetType: targetType, TargetID: targetID})
	return commentID, nil
}

// AI 评论上限检查与写入的全局锁：持有上限覆盖一次评论写入（含审核等），实例崩溃时自动过期
const (
	agentCommentLockKey = "ai:comment_quota"
	agentCommentLockTTL = 30 * time.Second
)

// createCommentLocked 在评论锁内检查上限并写入
func (w *agentWriteContext) createCommentLocked(ctx context.Context, targetType string, targetID, replyID uint, content string) (uint, *errs.ServiceError) {
	if svcerr := w.checkComment(targetType, targetID, replyID, content); svcerr != nil {
		return 0, svcerr
	}
	if svcerr := w.takeWriteSlot(); svcerr != nil {
		return 0, svcerr
	}
	return NewCommentService().CreateComment(ctx, &dto.CreateCommentReq{
		TargetID:   targetID,
		TargetType: targetType,
		Content:    content,
		ReplyID:    replyID,
		UserAgent:  "neo-blog-agent",
	})
}

// AgentSetLike AI 用户点赞 / 取消点赞（幂等：设为指定状态）
func (s *AIAgentService) AgentSetLike(ctx context.Context, targetType string, targetID uint, liked bool) (bool, *errs.ServiceError) {
	w, svcerr := loadAgentWriteContext(ctx, constant.ScopeLikesWrite)
	if svcerr != nil {
		return false, svcerr
	}
	before, err := repo.Like.LikedTargetIDs(w.agent.UserID, targetType, []uint{targetID})
	if err != nil {
		return false, errs.Internal("failed_to_get_target", err).WithResource("like")
	}
	if before[targetID] == liked {
		return liked, nil
	}
	if liked {
		today := dayStart(w.now)
		if n, _ := repo.AIAgent.CountUserLikes(w.agent.UserID, today); n >= int64(w.profile.Limits.LikesPerDay) {
			return false, errs.NewTooManyRequests("agent_daily_like_limit")
		}
		if n, _ := repo.AIAgent.CountAILikes(today); n >= int64(w.cfg.LikesPerDay) {
			return false, errs.NewTooManyRequests("agent_global_like_limit")
		}
	}
	if svcerr := w.takeWriteSlot(); svcerr != nil {
		return false, svcerr
	}
	result, svcerr := NewLikeService().ToggleLike(ctx, targetID, targetType, &liked)
	if svcerr != nil {
		return false, svcerr
	}
	recordEffect(w.run.RunID, dto.AgentEffectDto{Type: "like", TargetType: targetType, TargetID: targetID, Liked: result})
	return result, nil
}

func (w *agentWriteContext) canEdit(field string) bool {
	return w.cfg.ProfileSelfEdit && w.profile.SelfEdit.Enabled && slices.Contains(w.profile.SelfEdit.Fields, field)
}

// AgentUpdateProfile AI 用户修改自己的昵称、主题色（频率只由提示词约束，每次修改记录旧值以便回滚）
func (s *AIAgentService) AgentUpdateProfile(ctx context.Context, nickname, preferredColor *string) *errs.ServiceError {
	w, svcerr := loadAgentWriteContext(ctx, constant.ScopeProfileWrite)
	if svcerr != nil {
		return svcerr
	}
	user := w.agent.User
	changes := map[string]any{}
	effects := []dto.AgentEffectDto{}
	if nickname != nil {
		if !w.canEdit("nickname") {
			return errs.NewForbidden("agent_profile_field_not_allowed")
		}
		v := strings.TrimSpace(*nickname)
		if v == "" || utf8.RuneCountInString(v) > nicknameMaxLen {
			return errs.NewBadRequest("invalid_nickname")
		}
		if v != user.Nickname {
			changes["nickname"] = v
			effects = append(effects, dto.AgentEffectDto{Type: "profile", Field: "nickname", Old: user.Nickname, New: v})
		}
	}
	if preferredColor != nil {
		if !w.canEdit("preferred_color") {
			return errs.NewForbidden("agent_profile_field_not_allowed")
		}
		v := strings.TrimSpace(*preferredColor)
		if !(v == "" || slices.Contains(config.Strings("color_schemes"), v)) {
			return errs.NewBadRequest("invalid_preferred_color")
		}
		if v != user.PreferredColor {
			changes["preferred_color"] = v
			effects = append(effects, dto.AgentEffectDto{Type: "profile", Field: "preferred_color", Old: user.PreferredColor, New: v})
		}
	}
	if len(changes) == 0 {
		return nil
	}
	if svcerr := w.takeWriteSlot(); svcerr != nil {
		return svcerr
	}
	if err := repo.User.UpdateUserColumns(user.ID, changes); err != nil {
		return errs.Internal("failed_to_update_target", err).WithResource("user")
	}
	for _, e := range effects {
		recordEffect(w.run.RunID, e)
	}
	return nil
}

const agentAvatarMaxBytes = 5 << 20

// AgentSetAvatar AI 用户把一张外网图片设为头像或背景：由后端安全下载并转存到站点存储，不直接外链
func (s *AIAgentService) AgentSetAvatar(ctx context.Context, imageURL, kind string) (string, *errs.ServiceError) {
	w, svcerr := loadAgentWriteContext(ctx, constant.ScopeProfileWrite)
	if svcerr != nil {
		return "", svcerr
	}
	field, column := "avatar", "avatar_url"
	if kind == "background" {
		field, column = "background", "background_url"
	} else if kind != "" && kind != "avatar" {
		return "", errs.NewBadRequest("invalid_kind")
	}
	if !w.canEdit(field) {
		return "", errs.NewForbidden("agent_profile_field_not_allowed")
	}
	fetchCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	res, err := utils.SafeFetch(fetchCtx, imageURL, agentAvatarMaxBytes, "image/")
	if err != nil {
		return "", errs.NewBadRequest("image_fetch_failed").WithDetail(err.Error())
	}
	if res.Truncated {
		return "", errs.NewBadRequest("image_too_large")
	}
	mimeType := http.DetectContentType(res.Body)
	if !slices.Contains([]string{"image/png", "image/jpeg", "image/gif", "image/webp"}, mimeType) {
		return "", errs.NewBadRequest("unsupported_image_type")
	}
	// 能解码的格式检查尺寸，太小的图片不适合作为头像
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(res.Body)); err == nil && (cfg.Width < 64 || cfg.Height < 64) {
		return "", errs.NewBadRequest("image_too_small")
	}
	if svcerr := w.takeWriteSlot(); svcerr != nil {
		return "", svcerr
	}
	name := path.Base(strings.Split(res.FinalURL, "?")[0])
	if name == "" || name == "." || name == "/" {
		name = field
	}
	saved, svcerr := NewFileService().SaveFile(ctx, &SaveFileInput{
		Name:     clipRunes(name, 80),
		Size:     int64(len(res.Body)),
		MimeType: mimeType,
		Src:      bytes.NewReader(res.Body),
	})
	if svcerr != nil {
		return "", svcerr
	}
	old := utils.Ternary(field == "avatar", w.agent.User.AvatarUrl, w.agent.User.BackgroundUrl)
	if err := repo.User.UpdateUserColumns(w.agent.UserID, map[string]any{column: saved.URL}); err != nil {
		return "", errs.Internal("failed_to_update_target", err).WithResource("user")
	}
	recordEffect(w.run.RunID, dto.AgentEffectDto{Type: "profile", Field: column, Old: old, New: saved.URL})
	return saved.URL, nil
}

// ---------- 只读 ----------

// AgentComment 给模型看的评论
type AgentComment struct {
	ID         uint      `json:"id"`
	AuthorID   uint      `json:"author_id"`
	Author     string    `json:"author"`
	Content    string    `json:"content"`
	ReplyID    uint      `json:"reply_id,omitempty"`
	Depth      int       `json:"depth"`
	Replies    uint64    `json:"thread_replies,omitempty"`
	LikeCount  uint64    `json:"like_count"`
	LikedByMe  bool      `json:"liked_by_me"`
	Mine       bool      `json:"mine"`
	CreatedAt  time.Time `json:"created_at"`
	TargetType string    `json:"target_type"`
	TargetID   uint      `json:"target_id"`
}

// AgentListComments 读取文章 / 页面的评论；rootID 非零时读取整个回复线程
func (s *AIAgentService) AgentListComments(ctx context.Context, targetType string, targetID, rootID uint, limit int) ([]AgentComment, *errs.ServiceError) {
	if !ctxutils.HasAPITokenScope(ctx, constant.ScopePostsRead) {
		return nil, errs.NewForbidden("api_token_scope_insufficient")
	}
	// AI 用户只读前台能看到的内容：私密或已删除的文章 / 页面当作不存在，即使账号有更高的角色
	if reason := contentTargetSkipReason(targetType, targetID); reason != "" {
		return nil, errs.NewNotFound("target_not_found").WithResource(targetType)
	}
	limit = clampInt(limit, 1, 50)
	depth := 0
	req := &dto.GetCommentListReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: uint64(limit), OrderBy: constant.OrderByCreatedAt, Desc: false},
		TargetID:         targetID,
		TargetType:       targetType,
		RootID:           rootID,
		Depth:            &depth,
	}
	comments, svcerr := NewCommentService().GetCommentList(ctx, req)
	if svcerr != nil {
		return nil, svcerr
	}
	me, _ := ctxutils.GetCurrentUserID(ctx)
	result := make([]AgentComment, 0, len(comments))
	for _, c := range comments {
		result = append(result, AgentComment{
			ID: c.ID, AuthorID: c.User.ID, Author: utils.Ternary(c.User.Nickname != "", c.User.Nickname, c.User.Username),
			Content: c.Content, ReplyID: c.ReplyID, Depth: c.Depth, Replies: c.ThreadCount, LikeCount: c.LikeCount,
			LikedByMe: c.IsLiked, Mine: c.User.ID == me, CreatedAt: c.CreatedAt, TargetType: c.TargetType, TargetID: c.TargetID,
		})
	}
	return result, nil
}

// AgentRecallMemories AI 用户检索自己的记忆
func (s *AIAgentService) AgentRecallMemories(ctx context.Context, aboutUserID uint, query string, limit int) ([]dto.AgentMemoryDto, []dto.AgentRelationBrief, *errs.ServiceError) {
	run, ok := ctxutils.GetAgentRun(ctx)
	if !ok {
		return nil, nil, errs.NewForbidden("agent_lease_required")
	}
	memories, _, err := repo.AIAgent.ListMemories(&dto.ListAgentMemoriesReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: uint64(clampInt(limit, 1, 20))},
		ID:               run.AgentID, SubjectUserID: aboutUserID, Query: query,
	})
	if err != nil {
		return nil, nil, errs.Internal("failed_to_get_target", err).WithResource("agent_memory")
	}
	relations := []dto.AgentRelationBrief{}
	if aboutUserID != 0 {
		if rel, err := repo.AIAgent.GetRelation(run.AgentID, aboutUserID); err == nil && rel != nil {
			users, _ := repo.AIAgent.UsersBrief([]uint{aboutUserID})
			u := users[aboutUserID]
			relations = append(relations, dto.AgentRelationBrief{UserID: aboutUserID, Name: displayName(&u), Familiarity: currentFamiliarity(rel, time.Now()),
				Impression: rel.Impression, Topics: parseJSONOr(rel.Topics, []string{})})
		}
	}
	return s.memoryDtos(memories), relations, nil
}

// AgentImage 开放图库的一张图片
type AgentImage struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Thumb   string `json:"thumbnail"`
	Creator string `json:"creator"`
	License string `json:"license"`
	Source  string `json:"source"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Landing string `json:"landing_url"`
}

// AgentSearchImages 在开放图库（Openverse，CC0 / CC BY 等可复用授权）中找图，供 AI 用户挑选头像或背景
func (s *AIAgentService) AgentSearchImages(ctx context.Context, query string, limit int) ([]AgentImage, *errs.ServiceError) {
	if _, ok := ctxutils.GetAgentRun(ctx); !ok {
		return nil, errs.NewForbidden("agent_lease_required")
	}
	query = clipRunes(query, 100)
	if query == "" {
		return nil, errs.NewBadRequest("query_cannot_be_empty")
	}
	limit = clampInt(limit, 1, 20)
	endpoint := "https://api.openverse.org/v1/images/?" + url.Values{
		"q":         {query},
		"page_size": {strconv.Itoa(limit)},
		"license":   {"cc0,pdm,by,by-sa"},
		"mature":    {"false"},
	}.Encode()
	fetchCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	res, err := utils.SafeFetch(fetchCtx, endpoint, 2<<20, "application/json")
	if err != nil {
		return nil, errs.NewUnavailable("image_search_failed").WithDetail(err.Error())
	}
	var parsed struct {
		Results []struct {
			Title          string `json:"title"`
			URL            string `json:"url"`
			Thumbnail      string `json:"thumbnail"`
			Creator        string `json:"creator"`
			License        string `json:"license"`
			LicenseVersion string `json:"license_version"`
			Source         string `json:"source"`
			Width          int    `json:"width"`
			Height         int    `json:"height"`
			Landing        string `json:"foreign_landing_url"`
		} `json:"results"`
	}
	if err := json.Unmarshal(res.Body, &parsed); err != nil {
		return nil, errs.NewUnavailable("image_search_failed")
	}
	images := make([]AgentImage, 0, len(parsed.Results))
	for _, r := range parsed.Results {
		images = append(images, AgentImage{
			Title: clipRunes(r.Title, 100), URL: r.URL, Thumb: r.Thumbnail, Creator: clipRunes(r.Creator, 60),
			License: strings.ToUpper(strings.TrimSpace(r.License + " " + r.LicenseVersion)), Source: r.Source,
			Width: r.Width, Height: r.Height, Landing: r.Landing,
		})
	}
	return images, nil
}
