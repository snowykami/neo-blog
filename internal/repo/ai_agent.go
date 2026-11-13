package repo

import (
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

type aiAgentRepo struct{}

// AIAgent AI 用户（Agent 配置、运行记录、记忆、关系）的数据访问
var AIAgent = &aiAgentRepo{}

// ---------- AI 用户 ----------

func (r *aiAgentRepo) Create(agent *model.AIAgent) error {
	return GetDB().Create(agent).Error
}

// CreateWithUser 在同一事务中创建账号与 Agent 配置
func (r *aiAgentRepo) CreateWithUser(user *model.User, agent *model.AIAgent) error {
	return GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(user).Error; err != nil {
			return err
		}
		agent.UserID = user.ID
		return tx.Create(agent).Error
	})
}

func (r *aiAgentRepo) GetByID(id uint) (*model.AIAgent, error) {
	agent := &model.AIAgent{}
	if err := GetDB().Preload("User").First(agent, id).Error; err != nil {
		return nil, err
	}
	return agent, nil
}

func (r *aiAgentRepo) GetByUserID(userID uint) (*model.AIAgent, error) {
	agent := &model.AIAgent{}
	if err := GetDB().Preload("User").Where("user_id = ?", userID).First(agent).Error; err != nil {
		return nil, err
	}
	return agent, nil
}

func (r *aiAgentRepo) UpdateColumns(id uint, columns map[string]any) error {
	return GetDB().Model(&model.AIAgent{}).Where("id = ?", id).Updates(columns).Error
}

// SetStatusByGroup 整组暂停 / 恢复
func (r *aiAgentRepo) SetStatusByGroup(groupID uint, status, reason string) error {
	return GetDB().Model(&model.AIAgent{}).Where("group_id = ?", groupID).
		Updates(map[string]any{"status": status, "paused_reason": reason}).Error
}

// filterAgents 管理后台列表与导出共用的筛选条件，按用户名 / 昵称搜索
func filterAgents(req *dto.AdminListAIAgentsReq) *gorm.DB {
	db := GetDB().Model(&model.AIAgent{}).Joins("JOIN users ON users.id = ai_agents.user_id AND users.deleted_at IS NULL")
	if q := strings.TrimSpace(req.Query); q != "" {
		like := "%" + q + "%"
		db = db.Where("users.username LIKE ? OR users.nickname LIKE ?", like, like)
	}
	if req.Tier != "" {
		db = db.Where("ai_agents.tier = ?", req.Tier)
	}
	if req.Status != "" {
		db = db.Where("ai_agents.status = ?", req.Status)
	}
	if req.GroupID != 0 {
		db = db.Where("ai_agents.group_id = ?", req.GroupID)
	}
	return db
}

// List 管理后台列表
func (r *aiAgentRepo) List(req *dto.AdminListAIAgentsReq) ([]model.AIAgent, int64, error) {
	db := filterAgents(req)
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	size := int(req.Size)
	if size <= 0 || size > 100 {
		size = 20
	}
	var agents []model.AIAgent
	err := db.Preload("User").Order("ai_agents.id DESC").Limit(size).Offset(int(req.Offset())).Find(&agents).Error
	return agents, total, err
}

// ListAll 按筛选条件取出全部 AI 用户（导出用），按创建顺序
func (r *aiAgentRepo) ListAll(req *dto.AdminListAIAgentsReq) ([]model.AIAgent, error) {
	var agents []model.AIAgent
	err := filterAgents(req).Preload("User").Order("ai_agents.id ASC").Find(&agents).Error
	return agents, err
}

// ListByIDs 按 ID 取出 AI 用户（导出勾选项用），按创建顺序；不存在的 ID 跳过
func (r *aiAgentRepo) ListByIDs(ids []uint) ([]model.AIAgent, error) {
	var agents []model.AIAgent
	if len(ids) == 0 {
		return agents, nil
	}
	err := GetDB().Preload("User").Where("ai_agents.id IN ?", ids).Order("ai_agents.id ASC").Find(&agents).Error
	return agents, err
}

// ListActive 调度器使用：状态为启用且账号未被禁用的全部 AI 用户
func (r *aiAgentRepo) ListActive() ([]model.AIAgent, error) {
	var agents []model.AIAgent
	err := GetDB().Preload("User").
		Joins("JOIN users ON users.id = ai_agents.user_id AND users.deleted_at IS NULL AND users.disabled = ?", false).
		Where("ai_agents.status = ?", constant.AIAgentStatusActive).Find(&agents).Error
	return agents, err
}

// CountBy 按条件统计 AI 用户数
func (r *aiAgentRepo) CountBy(column, value string) (int64, error) {
	var n int64
	db := GetDB().Model(&model.AIAgent{})
	if column != "" {
		db = db.Where(column+" = ?", value)
	}
	return n, db.Count(&n).Error
}

// Delete 删除 Agent 配置及其记忆、关系、运行记录，并把账号标记为普通用户
func (r *aiAgentRepo) Delete(agent *model.AIAgent) error {
	return GetDB().Transaction(func(tx *gorm.DB) error {
		if err := deleteAgentData(tx, agent.ID); err != nil {
			return err
		}
		if err := tx.Delete(&model.AIAgent{}, agent.ID).Error; err != nil {
			return err
		}
		return tx.Model(&model.User{}).Where("id = ?", agent.UserID).Update("is_ai", false).Error
	})
}

func deleteAgentData(tx *gorm.DB, agentID uint) error {
	for _, m := range []any{&model.AgentMemory{}, &model.AgentRelation{}, &model.AgentRun{}} {
		if err := tx.Where("agent_id = ?", agentID).Delete(m).Error; err != nil {
			return err
		}
	}
	return nil
}

// deleteUserAIData 删除用户时清理：其作为 AI 用户的全部数据，以及其他 AI 对此人的记忆与关系
func deleteUserAIData(tx *gorm.DB, userID uint) error {
	var agent model.AIAgent
	if err := tx.Where("user_id = ?", userID).Limit(1).Find(&agent).Error; err != nil {
		return err
	}
	if agent.ID != 0 {
		if err := deleteAgentData(tx, agent.ID); err != nil {
			return err
		}
		if err := tx.Delete(&model.AIAgent{}, agent.ID).Error; err != nil {
			return err
		}
	}
	if err := tx.Where("user_id = ?", userID).Delete(&model.AgentRelation{}).Error; err != nil {
		return err
	}
	return tx.Where("subject_user_id = ?", userID).Delete(&model.AgentMemory{}).Error
}

// ---------- 群体 ----------

func (r *aiAgentRepo) CreateGroup(group *model.AIAgentGroup) error {
	return GetDB().Create(group).Error
}

func (r *aiAgentRepo) GetGroup(id uint) (*model.AIAgentGroup, error) {
	group := &model.AIAgentGroup{}
	if err := GetDB().First(group, id).Error; err != nil {
		return nil, err
	}
	return group, nil
}

func (r *aiAgentRepo) UpdateGroup(id uint, columns map[string]any) error {
	return GetDB().Model(&model.AIAgentGroup{}).Where("id = ?", id).Updates(columns).Error
}

func (r *aiAgentRepo) ListGroups() ([]model.AIAgentGroup, error) {
	var groups []model.AIAgentGroup
	return groups, GetDB().Order("id DESC").Find(&groups).Error
}

// ListGroupsByStatus 指定状态的群体（如仍在生成中的），按 id 先后
func (r *aiAgentRepo) ListGroupsByStatus(status string) ([]model.AIAgentGroup, error) {
	var groups []model.AIAgentGroup
	return groups, GetDB().Where("status = ?", status).Order("id").Find(&groups).Error
}

// IncrGroupCreated 群体的已创建数原子加一（生成进度，中断后据此续做）
func (r *aiAgentRepo) IncrGroupCreated(id uint) error {
	return GetDB().Model(&model.AIAgentGroup{}).Where("id = ?", id).UpdateColumn("created", gorm.Expr("created + 1")).Error
}

// GroupCounts 各群体的 AI 用户总数与启用数
func (r *aiAgentRepo) GroupCounts() (map[uint][2]int64, error) {
	var rows []struct {
		GroupID uint
		Total   int64
		Active  int64
	}
	err := GetDB().Model(&model.AIAgent{}).
		Select("group_id, COUNT(*) AS total, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS active", constant.AIAgentStatusActive).
		Where("group_id IS NOT NULL").Group("group_id").Scan(&rows).Error
	result := make(map[uint][2]int64, len(rows))
	for _, row := range rows {
		result[row.GroupID] = [2]int64{row.Total, row.Active}
	}
	return result, err
}

func (r *aiAgentRepo) GroupNames(ids []uint) (map[uint]string, error) {
	result := map[uint]string{}
	if len(ids) == 0 {
		return result, nil
	}
	var groups []model.AIAgentGroup
	if err := GetDB().Select("id, name").Where("id IN ?", ids).Find(&groups).Error; err != nil {
		return nil, err
	}
	for _, g := range groups {
		result[g.ID] = g.Name
	}
	return result, nil
}

// ---------- 运行记录 ----------

func (r *aiAgentRepo) CreateRuns(runs []model.AgentRun) error {
	if len(runs) == 0 {
		return nil
	}
	return GetDB().CreateInBatches(runs, 100).Error
}

func (r *aiAgentRepo) CreateRun(run *model.AgentRun) error {
	return GetDB().Create(run).Error
}

func (r *aiAgentRepo) GetRun(id uint) (*model.AgentRun, error) {
	run := &model.AgentRun{}
	if err := GetDB().First(run, id).Error; err != nil {
		return nil, err
	}
	return run, nil
}

func (r *aiAgentRepo) UpdateRun(id uint, columns map[string]any) error {
	return GetDB().Model(&model.AgentRun{}).Where("id = ?", id).Updates(columns).Error
}

// UpdateRunIf 仅在当前状态为 fromStatus 时更新，返回是否更新成功（用于领取任务等并发场景）
func (r *aiAgentRepo) UpdateRunIf(id uint, fromStatus string, columns map[string]any) (bool, error) {
	res := GetDB().Model(&model.AgentRun{}).Where("id = ? AND status = ?", id, fromStatus).Updates(columns)
	return res.RowsAffected == 1, res.Error
}

// UpdateRunLeased 仅在运行仍处于 leased 且持有匹配的租约令牌时更新（防止过期实例覆盖新实例结果）
func (r *aiAgentRepo) UpdateRunLeased(id uint, leaseToken string, columns map[string]any) (bool, error) {
	res := GetDB().Model(&model.AgentRun{}).
		Where("id = ? AND status = ? AND lease_token = ?", id, constant.AgentRunStatusLeased, leaseToken).
		Updates(columns)
	return res.RowsAffected == 1, res.Error
}

// DueRuns 已到执行时间的待办，按计划时间先后（试运行的计划时间提前，因而排在最前）
func (r *aiAgentRepo) DueRuns(now time.Time, limit int) ([]model.AgentRun, error) {
	var runs []model.AgentRun
	err := GetDB().Where("status = ? AND scheduled_at <= ?", constant.AgentRunStatusQueued, now).
		Order("scheduled_at, id").Limit(limit).Find(&runs).Error
	return runs, err
}

// LeasedAgentIDs 当前持有有效租约的 AI 用户，同一 AI 同时只跑一个任务
func (r *aiAgentRepo) LeasedAgentIDs(now time.Time) (map[uint]bool, error) {
	var ids []uint
	err := GetDB().Model(&model.AgentRun{}).Where("status = ? AND lease_until > ?", constant.AgentRunStatusLeased, now).Pluck("agent_id", &ids).Error
	result := make(map[uint]bool, len(ids))
	for _, id := range ids {
		result[id] = true
	}
	return result, err
}

// RequeueExpired 租约过期的任务重新排队，超过重试次数的记为失败
func (r *aiAgentRepo) RequeueExpired(now time.Time, maxAttempts int) error {
	db := GetDB().Model(&model.AgentRun{}).Where("status = ? AND lease_until <= ?", constant.AgentRunStatusLeased, now)
	if err := db.Session(&gorm.Session{}).Where("attempts >= ?", maxAttempts).
		Updates(map[string]any{"status": constant.AgentRunStatusFailed, "error": "lease expired", "finished_at": now, "lease_token": ""}).Error; err != nil {
		return err
	}
	return GetDB().Model(&model.AgentRun{}).Where("status = ? AND lease_until <= ? AND attempts < ?", constant.AgentRunStatusLeased, now, maxAttempts).
		Updates(map[string]any{"status": constant.AgentRunStatusQueued, "lease_until": nil, "lease_token": ""}).Error
}

// HasPendingRun AI 用户是否已有排队或执行中的任务
func (r *aiAgentRepo) HasPendingRun(agentID uint) (bool, error) {
	var n int64
	err := GetDB().Model(&model.AgentRun{}).Where("agent_id = ? AND status IN ?", agentID,
		[]string{constant.AgentRunStatusQueued, constant.AgentRunStatusLeased}).Count(&n).Error
	return n > 0, err
}

// PendingAgentIDs 已有排队或执行中任务的 AI 用户
func (r *aiAgentRepo) PendingAgentIDs() (map[uint]bool, error) {
	var ids []uint
	err := GetDB().Model(&model.AgentRun{}).Where("status IN ?", []string{constant.AgentRunStatusQueued, constant.AgentRunStatusLeased}).
		Distinct().Pluck("agent_id", &ids).Error
	result := make(map[uint]bool, len(ids))
	for _, id := range ids {
		result[id] = true
	}
	return result, err
}

// TriggerExists 是否已为该目标创建过某种触发的任务（如文章首次发布只曝光一次）
func (r *aiAgentRepo) TriggerExists(trigger, targetType string, targetID uint) (bool, error) {
	var n int64
	err := GetDB().Model(&model.AgentRun{}).Where("trigger_type = ? AND target_type = ? AND target_id = ?", trigger, targetType, targetID).
		Limit(1).Count(&n).Error
	return n > 0, err
}

// RunExistsForAgent 该 AI 是否已为这个目标排过任务（同一目标不重复触发，如一条评论既是对它的回复又 @ 了它）
func (r *aiAgentRepo) RunExistsForAgent(agentID uint, targetType string, targetID uint) (bool, error) {
	var n int64
	err := GetDB().Model(&model.AgentRun{}).Where("agent_id = ? AND target_type = ? AND target_id = ?", agentID, targetType, targetID).
		Limit(1).Count(&n).Error
	return n > 0, err
}

func (r *aiAgentRepo) CountRunsByStatus(status string) (int64, error) {
	var n int64
	return n, GetDB().Model(&model.AgentRun{}).Where("status = ?", status).Count(&n).Error
}

// ListRuns 运行记录列表
func (r *aiAgentRepo) ListRuns(req *dto.ListAgentRunsReq) ([]model.AgentRun, int64, error) {
	db := GetDB().Model(&model.AgentRun{})
	if req.AgentID != 0 {
		db = db.Where("agent_id = ?", req.AgentID)
	}
	if req.Status != "" {
		db = db.Where("status = ?", req.Status)
	}
	if req.Trigger != "" {
		db = db.Where("trigger_type = ?", req.Trigger)
	}
	switch req.Action {
	case "comment":
		db = db.Where("effects LIKE ?", `%"type":"comment"%`)
	case "like":
		db = db.Where("effects LIKE ?", `%"type":"like"%`)
	case "profile":
		db = db.Where("effects LIKE ?", `%"type":"profile"%`)
	case "none":
		// 后台任务（记忆整理、人设生成）本来就没有动作，不算「无视」
		db = db.Where("status = ? AND kind <> ? AND (effects = '' OR effects = '[]' OR effects IS NULL)", constant.AgentRunStatusDone, constant.AgentRunKindBackground)
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	size := int(req.Size)
	if size <= 0 || size > 100 {
		size = 20
	}
	var runs []model.AgentRun
	err := db.Order("id DESC").Limit(size).Offset(int(req.Offset())).Find(&runs).Error
	return runs, total, err
}

// SumTokens since 之后全部运行消耗的 token
func (r *aiAgentRepo) SumTokens(since time.Time) (int64, error) {
	var total int64
	err := GetDB().Model(&model.AgentRun{}).Where("created_at >= ?", since).
		Select("COALESCE(SUM(prompt_tokens + completion_tokens), 0)").Scan(&total).Error
	return total, err
}

// SumTokensByAgent 各 AI 用户 since 之后消耗的 token
func (r *aiAgentRepo) SumTokensByAgent(agentIDs []uint, since time.Time) (map[uint]int64, error) {
	result := map[uint]int64{}
	if len(agentIDs) == 0 {
		return result, nil
	}
	var rows []struct {
		AgentID uint
		Total   int64
	}
	err := GetDB().Model(&model.AgentRun{}).Select("agent_id, COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total").
		Where("agent_id IN ? AND created_at >= ?", agentIDs, since).Group("agent_id").Scan(&rows).Error
	for _, row := range rows {
		result[row.AgentID] = row.Total
	}
	return result, err
}

// AddRunUsage LLM 网关每次调用后累加用量
func (r *aiAgentRepo) AddRunUsage(runID uint, modelName string, prompt, cached, completion int) error {
	return GetDB().Model(&model.AgentRun{}).Where("id = ?", runID).Updates(map[string]any{
		"model":             modelName,
		"prompt_tokens":     gorm.Expr("prompt_tokens + ?", prompt),
		"cached_tokens":     gorm.Expr("cached_tokens + ?", cached),
		"completion_tokens": gorm.Expr("completion_tokens + ?", completion),
		"llm_calls":         gorm.Expr("llm_calls + 1"),
	}).Error
}

// PurgeRuns 删除 before 之前结束的运行记录
func (r *aiAgentRepo) PurgeRuns(before time.Time) (int64, error) {
	res := GetDB().Where("created_at < ? AND status IN ?", before,
		[]string{constant.AgentRunStatusDone, constant.AgentRunStatusSkipped, constant.AgentRunStatusFailed}).Delete(&model.AgentRun{})
	return res.RowsAffected, res.Error
}

// ---------- 计数（守卫与预过滤） ----------

// CountUserComments 用户 since 之后发表的评论数
func (r *aiAgentRepo) CountUserComments(userID uint, since time.Time) (int64, error) {
	var n int64
	return n, GetDB().Model(&model.Comment{}).Where("user_id = ? AND created_at >= ?", userID, since).Count(&n).Error
}

// RecentUserComments 用户最近发表的评论内容，新的在前
func (r *aiAgentRepo) RecentUserComments(userID uint, limit int) ([]string, error) {
	var contents []string
	err := GetDB().Model(&model.Comment{}).Where("user_id = ?", userID).
		Order("created_at DESC").Limit(limit).Pluck("content", &contents).Error
	return contents, err
}

// CountCommentsByUsers 各用户 since 之后发表的评论数（后台列表一次查出整页，没有评论的用户不在结果中）
func (r *aiAgentRepo) CountCommentsByUsers(userIDs []uint, since time.Time) (map[uint]int64, error) {
	return countByUsers(&model.Comment{}, userIDs, since)
}

// CountLikesByUsers 各用户 since 之后的点赞数
func (r *aiAgentRepo) CountLikesByUsers(userIDs []uint, since time.Time) (map[uint]int64, error) {
	return countByUsers(&model.Like{}, userIDs, since)
}

func countByUsers(table any, userIDs []uint, since time.Time) (map[uint]int64, error) {
	result := map[uint]int64{}
	if len(userIDs) == 0 {
		return result, nil
	}
	var rows []struct {
		UserID uint
		Total  int64
	}
	err := GetDB().Model(table).Select("user_id, COUNT(*) AS total").
		Where("user_id IN ? AND created_at >= ?", userIDs, since).Group("user_id").Scan(&rows).Error
	for _, row := range rows {
		result[row.UserID] = row.Total
	}
	return result, err
}

// CountUserLikes 用户 since 之后的点赞数
func (r *aiAgentRepo) CountUserLikes(userID uint, since time.Time) (int64, error) {
	var n int64
	return n, GetDB().Model(&model.Like{}).Where("user_id = ? AND created_at >= ?", userID, since).Count(&n).Error
}

// CountAIComments 全部 AI 用户 since 之后发表的评论数
func (r *aiAgentRepo) CountAIComments(since time.Time) (int64, error) {
	var n int64
	return n, GetDB().Model(&model.Comment{}).Joins("JOIN users ON users.id = comments.user_id").
		Where("users.is_ai = ? AND comments.created_at >= ?", true, since).Count(&n).Error
}

// CountAILikes 全部 AI 用户 since 之后的点赞数
func (r *aiAgentRepo) CountAILikes(since time.Time) (int64, error) {
	var n int64
	return n, GetDB().Model(&model.Like{}).Joins("JOIN users ON users.id = likes.user_id").
		Where("users.is_ai = ? AND likes.created_at >= ?", true, since).Count(&n).Error
}

// CountTargetComments 目标（文章 / 页面）下 AI 与真人的评论数（含回复）。
// AI 回复真人评论的那些另有上限（见 CountAIRepliesTo），不计入这里的 AI 评论数
func (r *aiAgentRepo) CountTargetComments(targetType string, targetID uint) (ai, human int64, err error) {
	var rows []struct {
		IsAI bool
		N    int64
	}
	err = GetDB().Model(&model.Comment{}).Joins("JOIN users ON users.id = comments.user_id").
		Joins("LEFT JOIN comments AS parents ON parents.id = comments.reply_id").
		Joins("LEFT JOIN users AS parent_users ON parent_users.id = parents.user_id").
		Select("users.is_ai AS is_ai, COUNT(*) AS n").
		Where("comments.target_type = ? AND comments.target_id = ?", targetType, targetID).
		Where("NOT (users.is_ai = ? AND comments.reply_id <> 0 AND COALESCE(parent_users.is_ai, ?) = ?)", true, true, false).
		Group("users.is_ai").Scan(&rows).Error
	for _, row := range rows {
		if row.IsAI {
			ai += row.N
		} else {
			human += row.N
		}
	}
	return
}

// CountUserRootCommentsOnTarget 用户在目标下的顶层评论数（不含回复）
func (r *aiAgentRepo) CountUserRootCommentsOnTarget(userID uint, targetType string, targetID uint) (int64, error) {
	var n int64
	return n, GetDB().Model(&model.Comment{}).Where("user_id = ? AND target_type = ? AND target_id = ? AND reply_id = 0", userID, targetType, targetID).Count(&n).Error
}

// CountAIRepliesTo 直接回复这条评论的 AI 评论数
func (r *aiAgentRepo) CountAIRepliesTo(commentID uint) (int64, error) {
	var n int64
	return n, GetDB().Model(&model.Comment{}).Joins("JOIN users ON users.id = comments.user_id").
		Where("comments.reply_id = ? AND users.is_ai = ?", commentID, true).Count(&n).Error
}

// LastCommentAt 用户最近一次评论的时间
func (r *aiAgentRepo) LastCommentAt(userID uint) (*time.Time, error) {
	var c model.Comment
	if err := GetDB().Where("user_id = ?", userID).Order("id DESC").Limit(1).Find(&c).Error; err != nil || c.ID == 0 {
		return nil, err
	}
	return &c.CreatedAt, nil
}

// CountPairReplies since 之后，在同一线程里 fromUser 回复 toUser 评论的次数
func (r *aiAgentRepo) CountPairReplies(fromUserID, toUserID, rootID uint, since time.Time) (int64, error) {
	var n int64
	err := GetDB().Model(&model.Comment{}).
		Joins("JOIN comments AS parent ON parent.id = comments.reply_id").
		Where("comments.user_id = ? AND parent.user_id = ? AND comments.created_at >= ?", fromUserID, toUserID, since).
		Where("(comments.root_id = ? OR comments.reply_id = ? OR comments.id = ?)", rootID, rootID, rootID).
		Count(&n).Error
	return n, err
}

// RecentTargetComments 目标下最近的评论内容，用于相似度去重
func (r *aiAgentRepo) RecentTargetComments(targetType string, targetID uint, limit int) ([]string, error) {
	var contents []string
	err := GetDB().Model(&model.Comment{}).Where("target_type = ? AND target_id = ?", targetType, targetID).
		Order("id DESC").Limit(limit).Pluck("content", &contents).Error
	return contents, err
}

// UserCommentedPosts 用户在给定文章中评论过 / 点赞过的
func (r *aiAgentRepo) UserPostInteractions(userID uint, postIDs []uint) (commented, liked map[uint]bool, err error) {
	commented, liked = map[uint]bool{}, map[uint]bool{}
	if len(postIDs) == 0 {
		return
	}
	var ids []uint
	if err = GetDB().Model(&model.Comment{}).Where("user_id = ? AND target_type = ? AND target_id IN ?", userID, constant.TargetTypePost, postIDs).
		Distinct().Pluck("target_id", &ids).Error; err != nil {
		return
	}
	for _, id := range ids {
		commented[id] = true
	}
	ids = nil
	if err = GetDB().Model(&model.Like{}).Where("user_id = ? AND target_type = ? AND target_id IN ?", userID, constant.TargetTypePost, postIDs).
		Pluck("target_id", &ids).Error; err != nil {
		return
	}
	for _, id := range ids {
		liked[id] = true
	}
	return
}

// AIUserIDs 给定用户中哪些是 AI 用户
func (r *aiAgentRepo) AIUserIDs(userIDs []uint) (map[uint]bool, error) {
	result := map[uint]bool{}
	if len(userIDs) == 0 {
		return result, nil
	}
	var ids []uint
	err := GetDB().Model(&model.User{}).Where("id IN ? AND is_ai = ?", userIDs, true).Pluck("id", &ids).Error
	for _, id := range ids {
		result[id] = true
	}
	return result, err
}

// ---------- 记忆 ----------

func (r *aiAgentRepo) CreateMemory(m *model.AgentMemory) error {
	return GetDB().Create(m).Error
}

func (r *aiAgentRepo) GetMemory(id uint) (*model.AgentMemory, error) {
	m := &model.AgentMemory{}
	if err := GetDB().First(m, id).Error; err != nil {
		return nil, err
	}
	return m, nil
}

func (r *aiAgentRepo) UpdateMemory(id uint, columns map[string]any) error {
	return GetDB().Model(&model.AgentMemory{}).Where("id = ?", id).Updates(columns).Error
}

func (r *aiAgentRepo) DeleteMemory(id uint) error {
	return GetDB().Delete(&model.AgentMemory{}, id).Error
}

func (r *aiAgentRepo) ListMemories(req *dto.ListAgentMemoriesReq) ([]model.AgentMemory, int64, error) {
	db := GetDB().Model(&model.AgentMemory{}).Where("agent_id = ?", req.ID)
	if req.Kind != "" {
		db = db.Where("kind = ?", req.Kind)
	}
	if req.SubjectUserID != 0 {
		db = db.Where("subject_user_id = ?", req.SubjectUserID)
	}
	if q := strings.TrimSpace(req.Query); q != "" {
		db = db.Where("content LIKE ?", "%"+q+"%")
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	size := int(req.Size)
	if size <= 0 || size > 100 {
		size = 20
	}
	var memories []model.AgentMemory
	err := db.Order("pinned DESC, id DESC").Limit(size).Offset(int(req.Offset())).Find(&memories).Error
	return memories, total, err
}

// RecentMemories 用于检索：最近的若干条未过期记忆
func (r *aiAgentRepo) RecentMemories(agentID uint, now time.Time, limit int) ([]model.AgentMemory, error) {
	var memories []model.AgentMemory
	err := GetDB().Where("agent_id = ? AND (expires_at IS NULL OR expires_at > ?)", agentID, now).
		Order("id DESC").Limit(limit).Find(&memories).Error
	return memories, err
}

// MemoriesSince 整理记忆用：since 之后新增的记忆
func (r *aiAgentRepo) MemoriesSince(agentID uint, since time.Time, limit int) ([]model.AgentMemory, error) {
	var memories []model.AgentMemory
	err := GetDB().Where("agent_id = ? AND created_at > ?", agentID, since).Order("id DESC").Limit(limit).Find(&memories).Error
	return memories, err
}

// AgentsWithNewMemories since 之后有新记忆、且上次整理早于 consolidatedBefore 的 AI 用户
func (r *aiAgentRepo) AgentsToConsolidate(consolidatedBefore time.Time, limit int) ([]model.AIAgent, error) {
	var agents []model.AIAgent
	err := GetDB().Preload("User").
		Where("(consolidated_at IS NULL OR consolidated_at < ?)", consolidatedBefore).
		Where("EXISTS (SELECT 1 FROM agent_memories m WHERE m.agent_id = ai_agents.id AND (ai_agents.consolidated_at IS NULL OR m.created_at > ai_agents.consolidated_at))").
		Order("consolidated_at").Limit(limit).Find(&agents).Error
	return agents, err
}

// PruneMemories 删除过期的未置顶记忆，并只保留每个 AI 最近的 maxItems 条情景记忆
func (r *aiAgentRepo) PruneMemories(agentID uint, now time.Time, maxItems int) error {
	if err := GetDB().Where("agent_id = ? AND pinned = ? AND expires_at IS NOT NULL AND expires_at <= ?", agentID, false, now).
		Delete(&model.AgentMemory{}).Error; err != nil {
		return err
	}
	if maxItems <= 0 {
		return nil
	}
	var keep []uint
	if err := GetDB().Model(&model.AgentMemory{}).Where("agent_id = ? AND kind = ? AND pinned = ?", agentID, constant.AgentMemoryKindEpisode, false).
		Order("id DESC").Limit(maxItems).Pluck("id", &keep).Error; err != nil {
		return err
	}
	if len(keep) < maxItems {
		return nil
	}
	return GetDB().Where("agent_id = ? AND kind = ? AND pinned = ? AND id NOT IN ?", agentID, constant.AgentMemoryKindEpisode, false, keep).
		Delete(&model.AgentMemory{}).Error
}

// PurgeExpiredMemories 全局清理过期记忆
func (r *aiAgentRepo) PurgeExpiredMemories(now time.Time) (int64, error) {
	res := GetDB().Where("pinned = ? AND expires_at IS NOT NULL AND expires_at <= ?", false, now).Delete(&model.AgentMemory{})
	return res.RowsAffected, res.Error
}

// ---------- 关系 ----------

func (r *aiAgentRepo) GetRelation(agentID, userID uint) (*model.AgentRelation, error) {
	rel := &model.AgentRelation{}
	err := GetDB().Where("agent_id = ? AND user_id = ?", agentID, userID).Limit(1).Find(rel).Error
	if err != nil {
		return nil, err
	}
	if rel.ID == 0 {
		return nil, nil
	}
	return rel, nil
}

func (r *aiAgentRepo) SaveRelation(rel *model.AgentRelation) error {
	return GetDB().Save(rel).Error
}

func (r *aiAgentRepo) DeleteRelation(id uint) error {
	return GetDB().Delete(&model.AgentRelation{}, id).Error
}

func (r *aiAgentRepo) ListRelations(agentID uint, page, size int) ([]model.AgentRelation, int64, error) {
	db := GetDB().Model(&model.AgentRelation{}).Where("agent_id = ?", agentID)
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if size <= 0 || size > 100 {
		size = 20
	}
	var rels []model.AgentRelation
	err := db.Order("familiarity DESC, id DESC").Limit(size).Offset((max(page, 1) - 1) * size).Find(&rels).Error
	return rels, total, err
}

// RelationsFor 检索：指定的人与熟悉度最高的若干人
func (r *aiAgentRepo) RelationsFor(agentID uint, userIDs []uint, top int) ([]model.AgentRelation, error) {
	var rels []model.AgentRelation
	if len(userIDs) > 0 {
		if err := GetDB().Where("agent_id = ? AND user_id IN ?", agentID, userIDs).Find(&rels).Error; err != nil {
			return nil, err
		}
	}
	var topRels []model.AgentRelation
	if err := GetDB().Where("agent_id = ? AND familiarity > 0", agentID).Order("familiarity DESC").Limit(top).Find(&topRels).Error; err != nil {
		return nil, err
	}
	seen := map[uint]bool{}
	for _, rel := range rels {
		seen[rel.ID] = true
	}
	for _, rel := range topRels {
		if !seen[rel.ID] {
			rels = append(rels, rel)
		}
	}
	return rels, nil
}

// UsersBrief 批量读取用户的基本信息
func (r *aiAgentRepo) UsersBrief(ids []uint) (map[uint]model.User, error) {
	result := map[uint]model.User{}
	if len(ids) == 0 {
		return result, nil
	}
	var users []model.User
	if err := GetDB().Select("id, username, nickname, avatar_url, is_ai").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	for _, u := range users {
		result[u.ID] = u
	}
	return result, nil
}

// ---------- 推荐流 ----------

// feedPostQuery 推荐流与触发事件读文章：只用到标题、摘要、标签、分类、作者与计数，不读正文与草稿（正文由 get_post 工具按需读取）
func feedPostQuery() *gorm.DB {
	return GetDB().Omit("content", "draft_content").Preload("Labels").Preload("Category").Preload("User")
}

// RecentPublicPosts 公开文章：since 之后发布的（按时间倒序）
func (r *aiAgentRepo) RecentPublicPosts(since time.Time, limit int) ([]model.Post, error) {
	var posts []model.Post
	err := feedPostQuery().
		Where("is_private = ? AND is_draft = ? AND created_at >= ?", false, false, since).Order("created_at DESC").Limit(limit).Find(&posts).Error
	return posts, err
}

// HotPublicPosts 热度最高的公开文章
func (r *aiAgentRepo) HotPublicPosts(limit int) ([]model.Post, error) {
	var posts []model.Post
	err := feedPostQuery().
		Where("is_private = ? AND is_draft = ?", false, false).Order("heat DESC, id DESC").Limit(limit).Find(&posts).Error
	return posts, err
}

// OldPublicPosts before 之前发布的公开文章，随机若干篇（用于挖坟）
func (r *aiAgentRepo) OldPublicPosts(before time.Time, limit int) ([]model.Post, error) {
	var posts []model.Post
	err := feedPostQuery().
		Where("is_private = ? AND is_draft = ? AND created_at < ?", false, false, before).Order("RANDOM()").Limit(limit).Find(&posts).Error
	return posts, err
}

// PostsByIDs 按 ID 读取文章（不含正文与草稿；是否公开、顺序由调用方处理）
func (r *aiAgentRepo) PostsByIDs(ids []uint) ([]model.Post, error) {
	var posts []model.Post
	if len(ids) == 0 {
		return posts, nil
	}
	err := feedPostQuery().Where("id IN ?", ids).Find(&posts).Error
	return posts, err
}
