package service

import (
	"context"
	"fmt"
	"math"
	"math/rand/v2"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 调度：后端决定“谁、何时、能不能”，Runner 决定“说什么”。
//   - 时间引擎：每分钟按 日均行动 × 作息 × 周末系数 × 全站节流 以泊松过程唤醒 AI，生成主动浏览任务
//   - 新文章发布：按兴趣加权抽样若干 AI，计划时间按衰减曲线分散在 48 小时内
//   - 被回复：按回应概率（对方是 AI 时再乘 0.5^深度）决定是否回应，受 AI 互动深度与同对往返次数约束

const (
	schedulerMaxWakesPerTick = 50
	feedSize                 = 4
	publishDelayMeanHours    = 6.0
	publishDelayMaxHours     = 48.0
)

// inQuietHours 当前是否处于全站静默时段（如 "02:00-07:00"，可跨零点）
func inQuietHours(spec string, now time.Time) bool {
	from, to, ok := strings.Cut(strings.TrimSpace(spec), "-")
	if !ok {
		return false
	}
	parse := func(s string) (int, bool) {
		h, m, _ := strings.Cut(strings.TrimSpace(s), ":")
		hh, err1 := strconv.Atoi(h)
		mm := 0
		var err2 error
		if m != "" {
			mm, err2 = strconv.Atoi(m)
		}
		if err1 != nil || err2 != nil || hh < 0 || hh > 24 || mm < 0 || mm > 59 {
			return 0, false
		}
		return hh*60 + mm, true
	}
	start, ok1 := parse(from)
	end, ok2 := parse(to)
	if !ok1 || !ok2 || start == end {
		return false
	}
	cur := now.Hour()*60 + now.Minute()
	if start < end {
		return cur >= start && cur < end
	}
	return cur >= start || cur < end
}

// wakeRatePerMinute 某个 AI 在 now 这一分钟被唤醒的期望次数
func wakeRatePerMinute(profile dto.AIAgentProfile, now time.Time) float64 {
	loc, err := time.LoadLocation(profile.Activity.Timezone)
	if err != nil {
		loc = time.Local
	}
	local := now.In(loc)
	weights, err := parseActiveHours(profile.Activity.ActiveHours)
	if err != nil {
		return 0
	}
	// 让一天的唤醒期望等于 daily_actions：按作息权重归一化
	total := 0.0
	for _, w := range weights {
		total += w
	}
	if total == 0 {
		return 0
	}
	rate := profile.Activity.DailyActions * weights[local.Hour()] / total / 60
	if wd := local.Weekday(); wd == time.Saturday || wd == time.Sunday {
		rate *= profile.Activity.WeekendFactor
	}
	return rate
}

// interestScore 文章与兴趣的匹配程度（标签、分类、标题包含兴趣词）
func interestScore(p *model.Post, interests []string) float64 {
	if len(interests) == 0 {
		return 0.3
	}
	text := strings.ToLower(p.Title)
	tags := make([]string, 0, len(p.Labels)+1)
	for _, l := range p.Labels {
		tags = append(tags, strings.ToLower(l.Name))
	}
	if p.Category != nil {
		tags = append(tags, strings.ToLower(p.Category.Name))
	}
	score := 0.0
	for _, interest := range interests {
		k := strings.ToLower(interest)
		if k == "" {
			continue
		}
		if slices.Contains(tags, k) {
			score += 1
		} else if strings.Contains(text, k) || slices.ContainsFunc(tags, func(t string) bool { return strings.Contains(t, k) }) {
			score += 0.5
		}
	}
	return math.Min(score, 3) / 3
}

// weightedPick 按权重不放回抽取 n 个
func weightedPick[T any](items []T, weight func(T) float64, n int) []T {
	pool := slices.Clone(items)
	result := make([]T, 0, n)
	for len(result) < n && len(pool) > 0 {
		total := 0.0
		for _, it := range pool {
			total += weight(it)
		}
		r := rand.Float64() * total
		idx := len(pool) - 1
		for i, it := range pool {
			r -= weight(it)
			if r <= 0 {
				idx = i
				break
			}
		}
		result = append(result, pool[idx])
		pool = slices.Delete(pool, idx, idx+1)
	}
	return result
}

// feedCandidates 推荐流的候选文章：近期新文章、热门、旧文
type feedCandidates struct {
	recent, hot, old []model.Post
}

func loadFeedCandidates(now time.Time) feedCandidates {
	var c feedCandidates
	c.recent, _ = repo.AIAgent.RecentPublicPosts(now.AddDate(0, 0, -14), 30)
	c.hot, _ = repo.AIAgent.HotPublicPosts(15)
	c.old, _ = repo.AIAgent.OldPublicPosts(now.AddDate(0, 0, -60), 10)
	return c
}

// buildFeed 为一个 AI 挑选推荐流：新文章与兴趣匹配优先，按 dig_old_posts 混入旧文
func buildFeed(c feedCandidates, profile dto.AIAgentProfile, selfUserID uint) []uint {
	seen := map[uint]bool{}
	pool := make([]model.Post, 0, len(c.recent)+len(c.hot)+1)
	for _, list := range [][]model.Post{c.recent, c.hot} {
		for _, p := range list {
			if !seen[p.ID] && p.UserID != selfUserID {
				seen[p.ID] = true
				pool = append(pool, p)
			}
		}
	}
	if len(c.old) > 0 && rand.Float64() < profile.Behavior.DigOldPosts {
		p := c.old[rand.IntN(len(c.old))]
		if !seen[p.ID] && p.UserID != selfUserID {
			pool = append(pool, p)
		}
	}
	picked := weightedPick(pool, func(p model.Post) float64 { return 0.15 + interestScore(&p, profile.Interests) }, feedSize)
	ids := make([]uint, 0, len(picked))
	for _, p := range picked {
		ids = append(ids, p.ID)
	}
	return ids
}

// randomDelay 性格中的行动延迟（分钟区间内均匀）
func randomDelay(profile dto.AIAgentProfile) time.Duration {
	lo, hi := profile.Behavior.DelayMinMinutes, profile.Behavior.DelayMaxMinutes
	if hi <= lo {
		return time.Duration(lo) * time.Minute
	}
	return time.Duration(lo+rand.IntN(hi-lo+1)) * time.Minute
}

func schedulerReady(cfg tools.AIAgentConfig) bool {
	return cfg.Enabled && tools.GetAIConfig().Configured()
}

// Tick 时间引擎：每分钟执行一次
func (s *AIAgentService) Tick(now time.Time) {
	cfg := tools.GetAIAgentConfig()
	if !schedulerReady(cfg) || inQuietHours(cfg.QuietHours, now) {
		return
	}
	if err := repo.AIAgent.RequeueExpired(now, agentRunMaxAttempts); err != nil {
		logrus.Warnf("requeue expired agent runs: %v", err)
	}
	agents, err := repo.AIAgent.ListActive()
	if err != nil {
		logrus.Warnf("list active agents: %v", err)
		return
	}
	pending, _ := repo.AIAgent.PendingAgentIDs()
	type candidate struct {
		agent   *model.AIAgent
		profile dto.AIAgentProfile
		rate    float64
	}
	candidates := make([]candidate, 0, len(agents))
	expectedPerHour := 0.0
	for i := range agents {
		profile := agents[i].ParsedProfile()
		if pending[agents[i].ID] || !slices.Contains(profile.Triggers, constant.AgentTriggerBrowse) {
			continue
		}
		rate := wakeRatePerMinute(profile, now)
		if rate <= 0 {
			continue
		}
		candidates = append(candidates, candidate{&agents[i], profile, rate})
		expectedPerHour += rate * 60
	}
	if len(candidates) == 0 {
		return
	}
	// 全站节流：本小时剩余调用额度不足以覆盖预期唤醒时，所有 AI 等比例变安静
	throttle := 1.0
	if cfg.LLMCallsPerHour > 0 && expectedPerHour > 0 {
		remaining := float64(cfg.LLMCallsPerHour) - float64(hourLLMCalls(now))
		minutesLeft := float64(60 - now.Minute())
		throttle = math.Max(0, math.Min(1, remaining/(expectedPerHour*minutesLeft/60)))
	}
	if throttle <= 0 {
		return
	}
	var feeds feedCandidates
	feedsLoaded := false
	today := dayStart(now)
	runs := make([]model.AgentRun, 0)
	for _, c := range candidates {
		if len(runs) >= schedulerMaxWakesPerTick {
			break
		}
		p := 1 - math.Exp(-c.rate*throttle)
		if rand.Float64() >= p {
			continue
		}
		// 今天的评论和点赞都用完了就不必醒来
		comments, _ := repo.AIAgent.CountUserComments(c.agent.UserID, today)
		likes, _ := repo.AIAgent.CountUserLikes(c.agent.UserID, today)
		if comments >= int64(c.profile.Limits.CommentsPerDay) && likes >= int64(c.profile.Limits.LikesPerDay) {
			continue
		}
		if !feedsLoaded {
			feeds = loadFeedCandidates(now)
			feedsLoaded = true
		}
		feed := buildFeed(feeds, c.profile, c.agent.UserID)
		if len(feed) == 0 {
			continue
		}
		runs = append(runs, model.AgentRun{
			AgentID: c.agent.ID, Kind: constant.AgentRunKindBrowse, Trigger: constant.AgentTriggerBrowse,
			Feed: mustJSON(feed), Status: constant.AgentRunStatusQueued, ScheduledAt: now,
		})
	}
	if len(runs) == 0 {
		return
	}
	if err := repo.AIAgent.CreateRuns(runs); err != nil {
		logrus.Warnf("create browse runs: %v", err)
		return
	}
	notifyAgentRuns()
}

// agentEventsSync 测试中同步处理事件，避免异步任务跨用例访问已替换的数据库
var agentEventsSync = false

// safeGo 异步执行事件处理，不影响用户请求
func safeGo(name string, fn func()) {
	if agentEventsSync {
		fn()
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logrus.Errorf("%s panic: %v", name, r)
			}
		}()
		fn()
	}()
}

// NotifyPostPublished 文章首次公开时调用（异步）
func NotifyPostPublished(postID uint) {
	safeGo("ai agent post published", func() { NewAIAgentService().OnPostPublished(postID, time.Now()) })
}

// NotifyCommentCreated 有新评论时调用（异步）：被回复的 AI 与评论里被 @ 的 AI 都在这一次处理里安排，
// 放在同一个 goroutine 里按顺序处理，避免两边各自查到「还没有任务」而把同一条评论排两遍
func NotifyCommentCreated(commentID uint) {
	safeGo("ai agent comment created", func() {
		svc := NewAIAgentService()
		now := time.Now()
		svc.OnCommentCreated(commentID, now)
		svc.OnCommentMentioned(commentID, now)
	})
}

// OnPostPublished 新文章首次公开：按兴趣加权抽样若干 AI，计划时间分散在 48 小时内
func (s *AIAgentService) OnPostPublished(postID uint, now time.Time) {
	cfg := tools.GetAIAgentConfig()
	if !schedulerReady(cfg) || cfg.PublishFanout <= 0 {
		return
	}
	posts, err := repo.AIAgent.PostsByIDs([]uint{postID})
	if err != nil || len(posts) == 0 || posts[0].IsPrivate {
		return
	}
	post := &posts[0]
	if exists, err := repo.AIAgent.TriggerExists(constant.AgentTriggerPostPublished, constant.TargetTypePost, postID); err != nil || exists {
		return
	}
	agents, err := repo.AIAgent.ListActive()
	if err != nil {
		return
	}
	type candidate struct {
		agent   *model.AIAgent
		profile dto.AIAgentProfile
		weight  float64
	}
	pool := make([]candidate, 0, len(agents))
	for i := range agents {
		profile := agents[i].ParsedProfile()
		if agents[i].UserID == post.UserID || !slices.Contains(profile.Triggers, constant.AgentTriggerPostPublished) {
			continue
		}
		weight := 0.1 + interestScore(post, profile.Interests)
		if agents[i].Tier == constant.AIAgentTierExpert {
			weight += 0.5
		}
		pool = append(pool, candidate{&agents[i], profile, weight})
	}
	picked := weightedPick(pool, func(c candidate) float64 { return c.weight }, cfg.PublishFanout)
	runs := make([]model.AgentRun, 0, len(picked))
	for _, c := range picked {
		hours := math.Min(rand.ExpFloat64()*publishDelayMeanHours, publishDelayMaxHours)
		delay := max(time.Duration(hours*float64(time.Hour)), time.Duration(c.profile.Behavior.DelayMinMinutes)*time.Minute)
		runs = append(runs, model.AgentRun{
			AgentID: c.agent.ID, Kind: constant.AgentRunKindEvent, Trigger: constant.AgentTriggerPostPublished,
			TargetType: constant.TargetTypePost, TargetID: postID, Status: constant.AgentRunStatusQueued, ScheduledAt: now.Add(delay),
		})
	}
	if len(runs) == 0 {
		return
	}
	if err := repo.AIAgent.CreateRuns(runs); err != nil {
		logrus.Warnf("create post published runs: %v", err)
		return
	}
	notifyAgentRuns()
}

// OnCommentCreated 有人回复了 AI 用户的评论：未超出上限时安排这个 AI 何时看到这条回复
func (s *AIAgentService) OnCommentCreated(commentID uint, now time.Time) {
	cfg := tools.GetAIAgentConfig()
	if !schedulerReady(cfg) {
		return
	}
	comment, err := repo.Comment.GetComment(commentID)
	if err != nil || comment.ReplyID == 0 || comment.IsPrivate {
		return
	}
	parent, err := repo.Comment.GetComment(comment.ReplyID)
	if err != nil || !parent.User.IsAI || parent.UserID == comment.UserID {
		return
	}
	agent, err := repo.AIAgent.GetByUserID(parent.UserID)
	if err != nil || agent.Status != constant.AIAgentStatusActive || agent.User.Disabled {
		return
	}
	profile := agent.ParsedProfile()
	if !slices.Contains(profile.Triggers, constant.AgentTriggerCommentReplied) {
		return
	}
	run := model.AgentRun{
		AgentID: agent.ID, Kind: constant.AgentRunKindEvent, Trigger: constant.AgentTriggerCommentReplied,
		TargetType: constant.TargetTypeComment, TargetID: comment.ID, Status: constant.AgentRunStatusQueued,
		ScheduledAt: now.Add(randomDelay(profile)),
	}
	skip := func(reason string) {
		run.Status, run.SkipReason, run.FinishedAt = constant.AgentRunStatusSkipped, reason, &now
		if err := repo.AIAgent.CreateRun(&run); err != nil {
			logrus.Warnf("record skipped agent run: %v", err)
		}
	}
	// AI 互动深度：这条评论所在回复链已有的连续 AI 评论数，回应后会再加一
	depth := aiChainDepth(comment.ID)
	if depth+1 > cfg.MaxChainDepth {
		skip("chain_depth")
		return
	}
	if comment.Depth >= tools.GetMaximumReplyDepth() {
		skip("reply_depth")
		return
	}
	if comment.User.IsAI {
		if !profile.AIInteraction.Enabled {
			skip("ai_interaction_disabled")
			return
		}
		rootID := comment.RootID
		if rootID == 0 {
			rootID = parent.ID
		}
		if n, _ := repo.AIAgent.CountPairReplies(agent.UserID, comment.UserID, rootID, dayStart(now)); n >= int64(cfg.PairExchanges) {
			skip("pair_exchange")
			return
		}
	}
	// 今天的评论额度已用完：回应不了，不必占名额、调用模型
	if agentCommentQuotaExhausted(agent, profile, cfg, now) {
		skip("daily_comment_limit")
		return
	}
	// 同一用户每天找同一个 AI 的次数（与 @ 共用一份名额）放在最后：前面任何一项跳过都不占名额。
	// AI 之间的来回另有 pair_exchange 上限，不占这里的名额
	if !comment.User.IsAI {
		if reason := takePairSlot(&comment.User, agent.UserID, cfg, now, "reply_pair_limit"); reason != "" {
			skip(reason)
			return
		}
	}
	// 回不回由 AI 看过回复后自己决定：性格中的回应概率只作为倾向写进提示词（见 agentrunner 的 taskPrompt），程序只保留上面的硬性上限
	if err := repo.AIAgent.CreateRun(&run); err != nil {
		logrus.Warnf("create comment replied run: %v", err)
		return
	}
	if !run.ScheduledAt.After(now) {
		notifyAgentRuns()
	}
}

// @ 唤醒的计数键（共享状态，多副本共用）
const (
	mentionDedupeTTL = 7 * 24 * time.Hour
)

func mentionDedupeKey(commentID, agentID uint) string {
	return fmt.Sprintf("ai:mention:c:%d:a:%d", commentID, agentID)
}

func mentionPairKey(mentionerID, agentUserID uint, now time.Time) string {
	return fmt.Sprintf("ai:mention:p:%d:%d:%s", mentionerID, agentUserID, dayStart(now).Format("20060102"))
}

func mentionUserHourKey(mentionerID uint, now time.Time) string {
	return fmt.Sprintf("ai:mention:u:%d:%s", mentionerID, now.Format("2006010215"))
}

func sharedCount(key string) int64 {
	v, ok, _ := sharedstate.Current().Get(key)
	if !ok {
		return 0
	}
	n, _ := strconv.ParseInt(v, 10, 64)
	return n
}

// takeMentionSlots 占用一次 @ 唤醒名额：同一用户每天 @ 同一 AI、同一用户每小时 @ 全部 AI 各有上限，超出时返回跳过原因。
// 管理员不受限；计数在共享状态中原子递增，多实例同时处理也不会超出
func takeMentionSlots(mentioner *model.User, agentUserID uint, cfg tools.AIAgentConfig, now time.Time) string {
	if mentioner.Role == constant.RoleAdmin {
		return ""
	}
	hourKey := mentionUserHourKey(mentioner.ID, now)
	// 先只读判断，避免已满的一项白白占掉另一项的名额
	if sharedCount(mentionPairKey(mentioner.ID, agentUserID, now)) >= int64(cfg.MentionsPerPair) {
		return "mention_pair_limit"
	}
	if sharedCount(hourKey) >= int64(cfg.MentionsPerUser) {
		return "mention_user_limit"
	}
	if reason := takePairSlot(mentioner, agentUserID, cfg, now, "mention_pair_limit"); reason != "" {
		return reason
	}
	// 共享状态不可用时按已满处理（保守）
	n, err := sharedstate.Current().Incr(hourKey, 2*time.Hour)
	if err != nil || n > int64(cfg.MentionsPerUser) {
		return "mention_user_limit"
	}
	return ""
}

// takePairSlot 占用一次「同一用户每天找同一个 AI」的名额：被 @ 与被回复共用这一份计数（上限为 ai_agents_mentions_per_pair_per_day），
// 超出时返回 reason。管理员不受限；计数在共享状态中原子递增，共享状态不可用时按已满处理（保守）
func takePairSlot(user *model.User, agentUserID uint, cfg tools.AIAgentConfig, now time.Time, reason string) string {
	if user.Role == constant.RoleAdmin {
		return ""
	}
	key := mentionPairKey(user.ID, agentUserID, now)
	if sharedCount(key) >= int64(cfg.MentionsPerPair) {
		return reason
	}
	n, err := sharedstate.Current().Incr(key, 48*time.Hour)
	if err != nil || n > int64(cfg.MentionsPerPair) {
		return reason
	}
	return ""
}

// agentCommentQuotaExhausted 这个 AI 今天的评论额度（个人上限或全站上限）是否已经用完：
// 被回复、被 @ 的运行目的就是回一条评论，额度用完时不必再调用模型
func agentCommentQuotaExhausted(agent *model.AIAgent, profile dto.AIAgentProfile, cfg tools.AIAgentConfig, now time.Time) bool {
	today := dayStart(now)
	if n, _ := repo.AIAgent.CountUserComments(agent.UserID, today); n >= int64(profile.Limits.CommentsPerDay) {
		return true
	}
	n, _ := repo.AIAgent.CountAIComments(today)
	return n >= int64(cfg.CommentsPerDay)
}

// OnCommentMentioned 有人在评论里 @ 了 AI 用户：给每个被点名的活跃 AI 安排一次运行。
// 与「被回复」共用同一套硬性上限（回复深度、AI 对话深度、AI 互聊次数）；
// 同一条评论对同一个 AI 只安排一次（这条评论恰是对它的回复时不再重复）。
// 另有成本上限：AI 今天的评论额度已用完不安排；同一用户 @ 同一 AI 每天、@ 全部 AI 每小时都有次数上限
func (s *AIAgentService) OnCommentMentioned(commentID uint, now time.Time) {
	cfg := tools.GetAIAgentConfig()
	if !schedulerReady(cfg) {
		return
	}
	comment, err := repo.Comment.GetComment(commentID)
	// 私密评论不投：AI 的回应是公开的，会把私密内容带出去
	if err != nil || comment.IsPrivate || len(comment.MentionUserIDs) == 0 {
		return
	}
	for _, mentionUserID := range comment.MentionUserIDs {
		agent, err := repo.AIAgent.GetByUserID(mentionUserID)
		if err != nil || agent.Status != constant.AIAgentStatusActive || agent.User.Disabled {
			continue
		}
		// 自己 @ 自己（AI 用户之间）不安排
		if agent.UserID == comment.UserID {
			continue
		}
		profile := agent.ParsedProfile()
		if !slices.Contains(profile.Triggers, constant.AgentTriggerCommentMentioned) {
			continue
		}
		// 这条评论已经为它排过任务（比如它本来就是对这条 AI 用户评论的回复）
		if exists, err := repo.AIAgent.RunExistsForAgent(agent.ID, constant.TargetTypeComment, comment.ID); err != nil || exists {
			continue
		}
		// 跨实例去重：同一条评论对同一个 AI 只处理一次（数据库查询与写入之间可能有其他实例插入）
		if ok, err := sharedstate.Current().SetNX(mentionDedupeKey(comment.ID, agent.ID), "1", mentionDedupeTTL); err != nil || !ok {
			continue
		}
		run := model.AgentRun{
			AgentID: agent.ID, Kind: constant.AgentRunKindEvent, Trigger: constant.AgentTriggerCommentMentioned,
			TargetType: constant.TargetTypeComment, TargetID: comment.ID, Status: constant.AgentRunStatusQueued,
			ScheduledAt: now.Add(randomDelay(profile)),
		}
		skip := func(reason string) {
			run.Status, run.SkipReason, run.FinishedAt = constant.AgentRunStatusSkipped, reason, &now
			if err := repo.AIAgent.CreateRun(&run); err != nil {
				logrus.Warnf("record skipped agent run: %v", err)
			}
		}
		if comment.Depth >= tools.GetMaximumReplyDepth() {
			skip("reply_depth")
			continue
		}
		// AI 互动深度：这条评论所在回复链已有的连续 AI 评论数，回应后会再加一
		if depth := aiChainDepth(comment.ID); depth+1 > cfg.MaxChainDepth {
			skip("chain_depth")
			continue
		}
		if comment.User.IsAI {
			if !profile.AIInteraction.Enabled {
				skip("ai_interaction_disabled")
				continue
			}
			rootID := comment.RootID
			if rootID == 0 {
				rootID = comment.ID
			}
			if n, _ := repo.AIAgent.CountPairReplies(agent.UserID, comment.UserID, rootID, dayStart(now)); n >= int64(cfg.PairExchanges) {
				skip("pair_exchange")
				continue
			}
		}
		// 今天的评论额度已用完：回应不了，不必调用模型
		if agentCommentQuotaExhausted(agent, profile, cfg, now) {
			skip("daily_comment_limit")
			continue
		}
		// 次数上限放在最后：前面任何一项跳过都不占名额
		if reason := takeMentionSlots(&comment.User, agent.UserID, cfg, now); reason != "" {
			skip(reason)
			continue
		}
		if err := repo.AIAgent.CreateRun(&run); err != nil {
			logrus.Warnf("create comment mentioned run: %v", err)
			continue
		}
		if !run.ScheduledAt.After(now) {
			notifyAgentRuns()
		}
	}
}

// RunScheduler 定时任务入口
func (s *AIAgentService) RunScheduler(_ context.Context) {
	s.Tick(time.Now())
}
