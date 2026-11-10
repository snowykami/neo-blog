package repo

import (
	"fmt"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type notificationRepo struct{}

var Notification = &notificationRepo{}

// likeGroupTypes 站内列表按「同类型 + 同目标 + 自然日」归并的类型，其余类型一行一组
var likeGroupTypes = []string{constant.NotificationTypePostLiked, constant.NotificationTypeCommentLiked}

// notificationActorMaxRunes 聚合行里昵称的截断长度，与文案表一致
const notificationActorMaxRunes = 20

// NotificationFilter 通知列表的筛选条件
type NotificationFilter struct {
	UserID     uint
	OnlyUnread bool
	Types      []string // 空表示不限类型
	TimeZone   string   // 收件人时区，用于把点赞归并到自然日
	Page       uint64
	Size       uint64
}

// NotificationGroup 一屏里的一行：普通通知是它自己，点赞类是多条明细归并后的一行
type NotificationGroup struct {
	// Notification 代表行：普通通知就是它本身，点赞类是组里最新的一条
	Notification model.Notification
	Count        int64 // 组内条数，点赞类用于「和另外 N 人」
	UnreadCount  int64 // 组内未读条数，> 0 即整组显示为未读
	// ActorNames 点赞组里最新的两个昵称，其它类型不用
	ActorNames []string
}

// CreateEvent 写入互动事件；同一去重键已存在时复用已有事件（取消点赞后再点赞不重复记事件）。
// 运行在调用方的事务里：Postgres 下任何失败语句都会让整个事务作废，所以冲突用 ON CONFLICT DO NOTHING 吸收，
// 不能先插入、撞唯一索引后再接着查
func (r *notificationRepo) CreateEvent(tx *gorm.DB, event *model.InteractionEvent) (*model.InteractionEvent, error) {
	if tx == nil {
		tx = GetDB()
	}
	result := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "dedupe_key"}},
		DoNothing: true,
	}).Create(event)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected > 0 {
		return event, nil
	}
	// 去重键已存在（含并发写入）：以库里已有的为准
	var existing model.InteractionEvent
	if err := tx.Where("dedupe_key = ?", event.DedupeKey).First(&existing).Error; err != nil {
		return nil, err
	}
	return &existing, nil
}

// CreateNotification 写入通知行；(event_id, user_id) 与 (dedupe_key, user_id) 唯一，重复写入直接忽略（幂等）。
// 不指定冲突列：两个唯一索引任一冲突都视为已写入，且语句本身不会失败（不会让调用方的事务作废）
func (r *notificationRepo) CreateNotification(tx *gorm.DB, notification *model.Notification) error {
	if tx == nil {
		tx = GetDB()
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(notification).Error
}

// UpsertThreadAggregate 折叠行（comment.thread_replied）：同一天同一线程同一收件人只有一行，
// 后续回复做 count+1、补 actor 名单、刷新 updated_at，并把 read_at 置回 NULL（有新活动就重新变未读）。
// 计数用 ON CONFLICT (dedupe_key, user_id) DO UPDATE 一条语句完成，并发回复也不会撞唯一索引；
// 该语句会锁住这一行直到事务结束，随后的「读 actor 名单 → 合并 → 回写」因此不会与其它事务交错
func (r *notificationRepo) UpsertThreadAggregate(tx *gorm.DB, notification *model.Notification) error {
	if tx == nil {
		tx = GetDB()
	}
	notification.AggregateCount = 1
	now := time.Now()
	notification.ActivityAt = now
	if err := tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "dedupe_key"}, {Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"aggregate_count": gorm.Expr("notifications.aggregate_count + 1"),
			"updated_at":      now,
			// 列表按最近活动排序：有新回复的折叠行回到顶部
			"activity_at": now,
			"read_at":     gorm.Expr("NULL"),
			// 已发过（或因已读跳过）的折叠行有了新回复，重新挂回附带状态，搭下一封邮件的车；
			// 新状态取本次写入算出的值（收件人已关闭邮件时仍是 skipped），其余状态（attached / sending）保持不变
			"email_state": gorm.Expr("CASE WHEN notifications.email_state IN (?, ?) THEN excluded.email_state ELSE notifications.email_state END",
				constant.NotificationEmailStateSent, constant.NotificationEmailStateSkipped),
		}),
	}).Create(notification).Error; err != nil {
		return err
	}
	var existing model.Notification
	if err := tx.Select("id", "aggregate_actors").
		Where("dedupe_key = ? AND user_id = ?", notification.DedupeKey, notification.UserID).
		First(&existing).Error; err != nil {
		return err
	}
	merged := mergeAggregateActors(existing.AggregateActors, notification.AggregateActors)
	if merged == existing.AggregateActors {
		return nil
	}
	return tx.Model(&model.Notification{}).Where("id = ?", existing.ID).UpdateColumn("aggregate_actors", merged).Error
}

// mergeAggregateActors 折叠行只保留前两个昵称，其余折成「和另外 N 人」
func mergeAggregateActors(existing, incoming string) string {
	names := splitAggregateActors(existing)
	if len(names) >= 2 || incoming == "" {
		return existing
	}
	for _, name := range splitAggregateActors(incoming) {
		if len(names) >= 2 {
			break
		}
		duplicated := false
		for _, kept := range names {
			if kept == name {
				duplicated = true
				break
			}
		}
		if !duplicated {
			names = append(names, name)
		}
	}
	return strings.Join(names, ",")
}

func splitAggregateActors(value string) []string {
	if value == "" {
		return nil
	}
	names := make([]string, 0, 2)
	for _, name := range strings.Split(value, ",") {
		if name != "" {
			names = append(names, name)
		}
	}
	return names
}

// DeleteByCommentIDs 评论被删除后清掉引用它的通知：免得收件人点进一条已经消失的评论
func (r *notificationRepo) DeleteByCommentIDs(tx *gorm.DB, commentIDs []uint) error {
	if len(commentIDs) == 0 {
		return nil
	}
	if tx == nil {
		tx = GetDB()
	}
	return tx.Unscoped().
		Where("(target_type = ? AND target_id IN ?) OR comment_id IN ?", constant.TargetTypeComment, commentIDs, commentIDs).
		Delete(&model.Notification{}).Error
}

// DeleteNotificationByDedupe 取消点赞时硬删对应的通知行（软删会撞唯一索引，见 4.4）。
// 直接按通知行自己的 (dedupe_key, user_id) 删除，不经过事件表：事件可能已被保留期清理，
// 经事件反查会漏删，下次点赞再撞上 (dedupe_key, user_id) 唯一索引而写不进新通知
func (r *notificationRepo) DeleteNotificationByDedupe(tx *gorm.DB, dedupeKey string, userID uint) error {
	if tx == nil {
		tx = GetDB()
	}
	return tx.Unscoped().
		Where("dedupe_key = ? AND user_id = ? AND type IN ?", dedupeKey, userID, likeGroupTypes).
		Delete(&model.Notification{}).Error
}

// List 一屏通知：点赞类按「类型 + 目标 + 自然日」归并，其余类型一行一组，
// 两种行由同一条分组查询产出，再按代表行补齐 actor 昵称
func (r *notificationRepo) List(filter *NotificationFilter) ([]NotificationGroup, int64, error) {
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.Size == 0 {
		filter.Size = 10
	}
	groupKey := notificationGroupKeyExpr(GetDB(), filter.TimeZone)
	base := func() *gorm.DB {
		query := GetDB().Model(&model.Notification{}).Where("user_id = ?", filter.UserID)
		if filter.OnlyUnread {
			query = query.Where("read_at IS NULL")
		}
		if len(filter.Types) > 0 {
			query = query.Where("type IN ?", filter.Types)
		}
		return query
	}

	var total int64
	grouped := base().Select(groupKey + " AS group_key").Group(groupKey)
	if err := GetDB().Table("(?) AS grouped", grouped).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []notificationGroupRow
	err := base().
		Select(groupKey + " AS group_key, MAX(id) AS max_id, COUNT(*) AS count, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread_count").
		Group(groupKey).
		// 按组内最近活动排序：折叠行有新回复时 activity_at 会刷新，点赞组取最新一条的时间
		Order("MAX(activity_at) DESC, MAX(id) DESC").
		Offset(int((filter.Page - 1) * filter.Size)).
		Limit(int(filter.Size)).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	groups, err := r.hydrate(rows, filter)
	if err != nil {
		return nil, 0, err
	}
	return groups, total, nil
}

// notificationGroupRow 分组查询的一行，group_key 只在 SQL 内使用
type notificationGroupRow struct {
	GroupKey    string
	MaxID       uint
	Count       int64
	UnreadCount int64
}

// hydrate 取代表行的完整内容，并给点赞组补上最新的两个昵称
func (r *notificationRepo) hydrate(rows []notificationGroupRow, filter *NotificationFilter) ([]NotificationGroup, error) {
	if len(rows) == 0 {
		return []NotificationGroup{}, nil
	}
	ids := make([]uint, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.MaxID)
	}
	var notifications []model.Notification
	if err := GetDB().Preload("Actor", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, username, nickname, avatar_url, is_ai")
	}).Where("id IN ?", ids).Find(&notifications).Error; err != nil {
		return nil, err
	}
	byID := make(map[uint]model.Notification, len(notifications))
	for _, notification := range notifications {
		byID[notification.ID] = notification
	}
	groups := make([]NotificationGroup, 0, len(rows))
	for _, row := range rows {
		notification, ok := byID[row.MaxID]
		if !ok {
			continue
		}
		group := NotificationGroup{Notification: notification, Count: row.Count, UnreadCount: row.UnreadCount}
		if isLikeGroupType(notification.Type) {
			names, err := r.likeGroupActorNames(&notification, filter)
			if err != nil {
				return nil, err
			}
			group.ActorNames = names
		}
		groups = append(groups, group)
	}
	return groups, nil
}

// likeGroupActorNames 点赞组里最新的两个昵称（同一人只算一次）
func (r *notificationRepo) likeGroupActorNames(notification *model.Notification, filter *NotificationFilter) ([]string, error) {
	start, end := notificationDayRange(notification.CreatedAt, filter.TimeZone)
	var rows []model.Notification
	if err := GetDB().Preload("Actor").
		Where("user_id = ? AND type = ? AND target_type = ? AND target_id = ? AND created_at >= ? AND created_at < ?",
			filter.UserID, notification.Type, notification.TargetType, notification.TargetID, start, end).
		Order("created_at DESC, id DESC").Limit(20).Find(&rows).Error; err != nil {
		return nil, err
	}
	names := make([]string, 0, 2)
	seen := map[uint]bool{}
	for _, row := range rows {
		if seen[row.ActorID] {
			continue
		}
		seen[row.ActorID] = true
		if name := notificationActorName(row.Actor); name != "" {
			names = append(names, name)
		}
		if len(names) >= 2 {
			break
		}
	}
	return names, nil
}

// UnreadGroupCount 未读徽标：未读的聚合组数（点赞组也算，见 N3），byType 为各类型的未读组数
func (r *notificationRepo) UnreadGroupCount(userID uint, timeZone string) (int64, map[string]int64, error) {
	groupKey := notificationGroupKeyExpr(GetDB(), timeZone)
	var rows []struct {
		Type  string
		Total int64
	}
	if err := GetDB().Model(&model.Notification{}).
		Select("type, COUNT(*) AS total").
		Where("user_id = ? AND read_at IS NULL", userID).
		Group("type, " + groupKey).
		Scan(&rows).Error; err != nil {
		return 0, nil, err
	}
	var total int64
	byType := map[string]int64{}
	for _, row := range rows {
		total++
		byType[row.Type]++
	}
	return total, byType, nil
}

// MarkRead 单条已读；若该行属于聚合组则整组一起置已读，返回受影响的条数。
// 读过就不必再发信：同一批行的待发邮件（pending）一并置为 skipped
func (r *notificationRepo) MarkRead(userID, id uint, timeZone string) (int64, error) {
	var notification model.Notification
	if err := GetDB().Where("id = ? AND user_id = ?", id, userID).First(&notification).Error; err != nil {
		return 0, err
	}
	scoped := func() *gorm.DB {
		query := GetDB().Model(&model.Notification{}).Where("user_id = ? AND read_at IS NULL", userID)
		switch {
		case notification.AggregateCount > 0:
			// 折叠行本身就是一组
			return query.Where("id = ?", notification.ID)
		case isLikeGroupType(notification.Type):
			start, end := notificationDayRange(notification.CreatedAt, timeZone)
			return query.Where("type = ? AND target_type = ? AND target_id = ? AND created_at >= ? AND created_at < ?",
				notification.Type, notification.TargetType, notification.TargetID, start, end)
		default:
			return query.Where("id = ?", notification.ID)
		}
	}
	if err := cancelPendingEmails(scoped()); err != nil {
		return 0, err
	}
	result := scoped().Update("read_at", time.Now())
	return result.RowsAffected, result.Error
}

// MarkAllRead 全部已读；beforeID 用于避免把请求期间新到的通知也标掉
func (r *notificationRepo) MarkAllRead(userID uint, beforeID *uint) (int64, error) {
	scoped := func() *gorm.DB {
		query := GetDB().Model(&model.Notification{}).Where("user_id = ? AND read_at IS NULL", userID)
		if beforeID != nil && *beforeID > 0 {
			query = query.Where("id <= ?", *beforeID)
		}
		return query
	}
	if err := cancelPendingEmails(scoped()); err != nil {
		return 0, err
	}
	result := scoped().Update("read_at", time.Now())
	return result.RowsAffected, result.Error
}

// cancelPendingEmails 已读即视为不需要邮件：同一批行里待发（pending）与等搭车（attached）的直接置为 skipped。
// 已进批次（sending）与已发（sent）不动：前者正在发送中，后者已经送达。
// 这里只是提前清掉，发信前 worker 仍会按 read_at 再复核一次（标记已读与领取可能并发）
func cancelPendingEmails(query *gorm.DB) error {
	return query.Where("email_state IN ?", []string{constant.NotificationEmailStatePending, constant.NotificationEmailStateAttached}).
		Updates(map[string]any{
			"email_state":    constant.NotificationEmailStateSkipped,
			"email_last_err": NotificationEmailSkipRead,
		}).Error
}

// GetByIDAndUser 读取本人的一条通知，用于单条已读与越权判断
func (r *notificationRepo) GetByIDAndUser(userID, id uint) (*model.Notification, error) {
	var notification model.Notification
	err := GetDB().Where("id = ? AND user_id = ?", id, userID).First(&notification).Error
	if err != nil {
		return nil, err
	}
	return &notification, nil
}

// notificationGroupKeyExpr 分组键：点赞类按「类型 + 目标 + 自然日」归并，其余按自身 id 一行一组。
// 分天在 SQL 里按收件人时区的固定偏移折算，两种方言写法不同（见 3.4）
func notificationGroupKeyExpr(db *gorm.DB, timeZone string) string {
	minutes := notificationZoneOffsetMinutes(timeZone)
	var day string
	if db.Dialector.Name() == "postgres" {
		day = fmt.Sprintf("to_char(created_at + make_interval(mins => %d), 'YYYYMMDD')", minutes)
	} else {
		day = "strftime('%Y%m%d', datetime(created_at, '" + fmt.Sprintf("%+d minutes", minutes) + "'))"
	}
	likeTypes := "'" + constant.NotificationTypePostLiked + "','" + constant.NotificationTypeCommentLiked + "'"
	return "CASE WHEN type IN (" + likeTypes + ") THEN type || ':' || target_type || ':' || target_id || ':' || " + day +
		" ELSE 'id:' || id END"
}

// notificationZoneOffsetMinutes 收件人时区相对 UTC 的偏移分钟数；为空或非法时用服务器时区
func notificationZoneOffsetMinutes(timeZone string) int {
	location := time.Local
	if timeZone != "" {
		if loaded, err := time.LoadLocation(timeZone); err == nil {
			location = loaded
		}
	}
	_, offset := time.Now().In(location).Zone()
	return offset / 60
}

// notificationDayRange 收件人时区下该时刻所在自然日的起止（右开区间）
func notificationDayRange(at time.Time, timeZone string) (time.Time, time.Time) {
	location := time.Local
	if timeZone != "" {
		if loaded, err := time.LoadLocation(timeZone); err == nil {
			location = loaded
		}
	}
	local := at.In(location)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	return start, start.AddDate(0, 0, 1)
}

// notificationActorName 聚合行里的昵称：优先昵称，其次用户名，超长截断
func notificationActorName(user model.User) string {
	name := user.Nickname
	if name == "" {
		name = user.Username
	}
	runes := []rune(strings.TrimSpace(name))
	if len(runes) == 0 {
		return ""
	}
	if len(runes) > notificationActorMaxRunes {
		return string(runes[:notificationActorMaxRunes]) + "…"
	}
	return string(runes)
}

func isLikeGroupType(eventType string) bool {
	for _, t := range likeGroupTypes {
		if t == eventType {
			return true
		}
	}
	return false
}

// ---- 邮件投递（outbox：notifications.email_state 就是状态机，见 docs/notification-spec.md 6.3）----

// 跳过原因：skipped 的行把原因写进 email_last_err，后台排查时能看出为什么没发
const (
	NotificationEmailSkipRead          = "skip:read"           // 收件人已读
	NotificationEmailSkipUnsubscribed  = "skip:unsubscribed"   // 收件人关掉了该类型或全部通知邮件
	NotificationEmailSkipRecipientGone = "skip:recipient_gone" // 收件人已注销、被禁用或没有邮箱
	NotificationEmailSkipOverdue       = "skip:overdue"        // 逾期太久（站点邮件关闭期间积压），不再补发
)

// ListDueEmailPending 取出已到期的重要通知，按收件人与 id 排序
func (r *notificationRepo) ListDueEmailPending(now time.Time, limit int) ([]model.Notification, error) {
	var notifications []model.Notification
	err := GetDB().
		Where("email_state = ? AND email_next_at IS NOT NULL AND email_next_at <= ?", constant.NotificationEmailStatePending, now).
		Order("user_id ASC, id ASC").Limit(limit).Find(&notifications).Error
	return notifications, err
}

// ClaimEmailBatch 条件更新 pending → sending 并记下领取时间，领到的行才是本封的主列表；
// 被别的实例领走或已被标记已读而跳过的行不会返回
func (r *notificationRepo) ClaimEmailBatch(ids []uint, now time.Time) ([]model.Notification, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	if err := GetDB().Model(&model.Notification{}).
		Where("id IN ? AND email_state = ?", ids, constant.NotificationEmailStatePending).
		Updates(map[string]any{
			"email_state":      constant.NotificationEmailStateSending,
			"email_claimed_at": now,
		}).Error; err != nil {
		return nil, err
	}
	// 邮件正文要渲染作者昵称与头像：这里必须带出 Actor，否则昵称与头像都是空的
	var claimed []model.Notification
	if err := GetDB().Preload("Actor", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, username, nickname, avatar_url, is_ai")
	}).Where("id IN ? AND email_state = ?", ids, constant.NotificationEmailStateSending).
		Order("id ASC").Find(&claimed).Error; err != nil {
		return nil, err
	}
	return claimed, nil
}

// ClaimAttachedForEmail 领取收件人在时间窗口内、仍未读的附带行（点赞、AI 互动、线程活动），按时间倒序，最多 limit 条。
// 与主列表一样条件更新 attached → sending：领取期间被标记已读的行不会被带上，也不会被另一封邮件重复带上。
// 附带行领取后 email_next_at 仍为空，收回超时批次时据此把它们退回 attached 而不是 pending
func (r *notificationRepo) ClaimAttachedForEmail(userID uint, since time.Time, limit int, now time.Time) ([]model.Notification, error) {
	if limit <= 0 {
		return nil, nil
	}
	var candidates []uint
	if err := GetDB().Model(&model.Notification{}).
		Where("user_id = ? AND email_state = ? AND read_at IS NULL AND created_at >= ?", userID, constant.NotificationEmailStateAttached, since).
		Order("created_at DESC, id DESC").Limit(limit).Pluck("id", &candidates).Error; err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	if err := GetDB().Model(&model.Notification{}).
		Where("id IN ? AND email_state = ? AND read_at IS NULL", candidates, constant.NotificationEmailStateAttached).
		Updates(map[string]any{
			"email_state":      constant.NotificationEmailStateSending,
			"email_claimed_at": now,
		}).Error; err != nil {
		return nil, err
	}
	var claimed []model.Notification
	err := GetDB().Where("id IN ? AND email_state = ?", candidates, constant.NotificationEmailStateSending).
		Order("created_at DESC, id DESC").Find(&claimed).Error
	return claimed, err
}

// ReleaseAttachedEmails 这封没发出去：领到的附带行退回 attached，等下一封
func (r *notificationRepo) ReleaseAttachedEmails(ids []uint) error {
	if len(ids) == 0 {
		return nil
	}
	return GetDB().Model(&model.Notification{}).
		Where("id IN ? AND email_state = ?", ids, constant.NotificationEmailStateSending).
		Updates(map[string]any{
			"email_state":      constant.NotificationEmailStateAttached,
			"email_claimed_at": nil,
		}).Error
}

// MarkEmailsSent 发送成功后置为已发送
func (r *notificationRepo) MarkEmailsSent(ids []uint, now time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	return GetDB().Model(&model.Notification{}).Where("id IN ?", ids).Updates(map[string]any{
		"email_state":    constant.NotificationEmailStateSent,
		"email_sent_at":  now,
		"email_last_err": "",
	}).Error
}

// MarkEmailsSkipped 不再发送（已读、退订、收件人不可用、逾期），reason 见 NotificationEmailSkip*
func (r *notificationRepo) MarkEmailsSkipped(ids []uint, reason string) error {
	if len(ids) == 0 {
		return nil
	}
	return GetDB().Model(&model.Notification{}).Where("id IN ?", ids).Updates(map[string]any{
		"email_state":    constant.NotificationEmailStateSkipped,
		"email_last_err": reason,
	}).Error
}

// RescheduleEmails 发送失败：整批退回 pending 并推迟到 nextAt；退避次数用尽时置为 failed
func (r *notificationRepo) RescheduleEmails(ids []uint, nextAt time.Time, lastErr string, failed bool) error {
	if len(ids) == 0 {
		return nil
	}
	state := constant.NotificationEmailStatePending
	if failed {
		state = constant.NotificationEmailStateFailed
	}
	return GetDB().Model(&model.Notification{}).Where("id IN ?", ids).Updates(map[string]any{
		"email_state":      state,
		"email_attempts":   gorm.Expr("email_attempts + 1"),
		"email_next_at":    nextAt,
		"email_last_err":   truncateBytes(lastErr, 255),
		"email_claimed_at": nil,
	}).Error
}

// DeferEmails 已领取的行退回 pending 并推迟下一次尝试（限速时用），不计失败次数
func (r *notificationRepo) DeferEmails(ids []uint, nextAt time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	return GetDB().Model(&model.Notification{}).Where("id IN ?", ids).Updates(map[string]any{
		"email_state":      constant.NotificationEmailStatePending,
		"email_next_at":    nextAt,
		"email_claimed_at": nil,
	}).Error
}

// SkipOverdueEmails 到期后迟迟没发出去的重要通知（站点邮件关闭期间积压、长期限速）超过 before 就不再补发，
// 置为 skipped：重新打开邮件时只发近期的，不会把积压的旧通知一次性灌进收件箱
func (r *notificationRepo) SkipOverdueEmails(before time.Time) (int64, error) {
	result := GetDB().Model(&model.Notification{}).
		Where("email_state = ? AND email_next_at IS NOT NULL AND email_next_at < ?", constant.NotificationEmailStatePending, before).
		Updates(map[string]any{
			"email_state":    constant.NotificationEmailStateSkipped,
			"email_last_err": NotificationEmailSkipOverdue,
		})
	return result.RowsAffected, result.Error
}

// ReclaimStaleSendingEmails 收回领取时间早于 before 仍停在 sending 的行（发信实例中途退出）：
// 附带行（email_next_at 为空）退回 attached；重要行算一次失败，次数用尽置 failed，否则退回 pending 立即重试
func (r *notificationRepo) ReclaimStaleSendingEmails(before, now time.Time, maxAttempts int) (int64, error) {
	stale := func() *gorm.DB {
		return GetDB().Model(&model.Notification{}).
			Where("email_state = ? AND (email_claimed_at IS NULL OR email_claimed_at < ?)", constant.NotificationEmailStateSending, before)
	}
	var total int64
	result := stale().Where("email_next_at IS NULL").Updates(map[string]any{
		"email_state":      constant.NotificationEmailStateAttached,
		"email_claimed_at": nil,
	})
	if result.Error != nil {
		return total, result.Error
	}
	total += result.RowsAffected
	const reason = "sending timed out (instance exited?)"
	result = stale().Where("email_next_at IS NOT NULL AND email_attempts + 1 >= ?", maxAttempts).Updates(map[string]any{
		"email_state":      constant.NotificationEmailStateFailed,
		"email_attempts":   gorm.Expr("email_attempts + 1"),
		"email_last_err":   reason,
		"email_claimed_at": nil,
	})
	if result.Error != nil {
		return total, result.Error
	}
	total += result.RowsAffected
	result = stale().Where("email_next_at IS NOT NULL").Updates(map[string]any{
		"email_state":      constant.NotificationEmailStatePending,
		"email_attempts":   gorm.Expr("email_attempts + 1"),
		"email_next_at":    now,
		"email_last_err":   reason,
		"email_claimed_at": nil,
	})
	if result.Error != nil {
		return total, result.Error
	}
	return total + result.RowsAffected, nil
}

// SkipStaleAttachedEmails 长期没有重要邮件的收件人：附带行超过搭车窗口后置为 skipped，不再积压
func (r *notificationRepo) SkipStaleAttachedEmails(before time.Time) (int64, error) {
	result := GetDB().Model(&model.Notification{}).
		Where("email_state = ? AND created_at < ?", constant.NotificationEmailStateAttached, before).
		Update("email_state", constant.NotificationEmailStateSkipped)
	return result.RowsAffected, result.Error
}

// DeleteBefore 保留期清理：硬删该时间之前的通知，再删不再被任何通知引用的旧事件。
// 取消点赞后再点赞会复用最早的那条事件（created_at 是第一次点赞的时间），而新通知行的 created_at 是最近一次；
// 只按事件的 created_at 删会删掉仍被通知引用的事件，所以要排除被引用的
func (r *notificationRepo) DeleteBefore(before time.Time) (notifications, events int64, err error) {
	result := GetDB().Unscoped().Where("created_at < ?", before).Delete(&model.Notification{})
	if result.Error != nil {
		return 0, 0, result.Error
	}
	notifications = result.RowsAffected
	referenced := GetDB().Unscoped().Model(&model.Notification{}).Select("1").
		Where("notifications.event_id = interaction_events.id")
	result = GetDB().Unscoped().Where("created_at < ? AND NOT EXISTS (?)", before, referenced).Delete(&model.InteractionEvent{})
	if result.Error != nil {
		return notifications, 0, result.Error
	}
	return notifications, result.RowsAffected, nil
}

// truncateBytes 按字节截断（错误信息列有长度上限），不截断多字节字符
func truncateBytes(text string, max int) string {
	if len(text) <= max {
		return text
	}
	cut := max
	for cut > 0 && text[cut]&0xC0 == 0x80 {
		cut--
	}
	return text[:cut]
}

// ListGroupMembers 展开一条聚合行：返回同类型 + 同目标 + 同一自然日的全部明细（按时间倒序）。
// 折叠行（线程活动）本身就是一行，直接返回它自己
func (r *notificationRepo) ListGroupMembers(userID, id uint, timeZone string, limit int) ([]model.Notification, error) {
	var notification model.Notification
	if err := GetDB().Where("id = ? AND user_id = ?", id, userID).First(&notification).Error; err != nil {
		return nil, err
	}
	if notification.AggregateCount > 0 || !isLikeGroupType(notification.Type) {
		return []model.Notification{notification}, nil
	}
	start, end := notificationDayRange(notification.CreatedAt, timeZone)
	var rows []model.Notification
	err := GetDB().Preload("Actor").
		Where("user_id = ? AND type = ? AND target_type = ? AND target_id = ? AND created_at >= ? AND created_at < ?",
			userID, notification.Type, notification.TargetType, notification.TargetID, start, end).
		Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

// ListEmailDeliveries 后台排查：按状态列出邮件投递记录（附带收件人信息由调用方补齐）
func (r *notificationRepo) ListEmailDeliveries(state string, page, size uint64) ([]model.Notification, int64, error) {
	query := GetDB().Model(&model.Notification{})
	if state != "" {
		query = query.Where("email_state = ?", state)
	} else {
		// 默认只看需要人工注意的：失败与正在发送
		query = query.Where("email_state IN ?", []string{constant.NotificationEmailStateFailed, constant.NotificationEmailStateSending})
	}
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if page < 1 {
		page = 1
	}
	if size == 0 {
		size = 20
	}
	var rows []model.Notification
	err := query.Order("updated_at DESC, id DESC").Offset(int((page - 1) * size)).Limit(int(size)).Find(&rows).Error
	return rows, total, err
}

// RetryEmail 后台手动重试一条投递：只接受失败的行与超时仍停在 sending 的重要行，退回 pending 并立即可发。
// 已发送、已跳过、等搭车的行不能重试（否则会重复发信或绕过收件人的退订）；返回是否真的退回了
func (r *notificationRepo) RetryEmail(id uint, staleBefore, now time.Time) (bool, error) {
	result := GetDB().Model(&model.Notification{}).
		Where("id = ?", id).
		Where("email_state = ? OR (email_state = ? AND email_next_at IS NOT NULL AND (email_claimed_at IS NULL OR email_claimed_at < ?))",
			constant.NotificationEmailStateFailed, constant.NotificationEmailStateSending, staleBefore).
		Updates(map[string]any{
			"email_state":      constant.NotificationEmailStatePending,
			"email_next_at":    now,
			"email_attempts":   0,
			"email_claimed_at": nil,
		})
	return result.RowsAffected > 0, result.Error
}

// GetEmailDelivery 读一条投递记录（不限收件人，只给管理员排查用）
func (r *notificationRepo) GetEmailDelivery(id uint) (*model.Notification, error) {
	var notification model.Notification
	if err := GetDB().Where("id = ?", id).First(&notification).Error; err != nil {
		return nil, err
	}
	return &notification, nil
}

// LatestActivity 收件人最近一条通知的 id 与活动时间：实时推送带上它，前端据此判断「来了新通知」。
// 只看未读组数会漏掉点赞并入已有未读组、折叠行有新回复这类组数不变的情况
func (r *notificationRepo) LatestActivity(userID uint) (uint, *time.Time, error) {
	var latest model.Notification
	err := GetDB().Select("id", "activity_at").Where("user_id = ?", userID).
		Order("activity_at DESC, id DESC").Limit(1).Find(&latest).Error
	if err != nil || latest.ID == 0 {
		return 0, nil, err
	}
	at := latest.ActivityAt
	return latest.ID, &at, nil
}
