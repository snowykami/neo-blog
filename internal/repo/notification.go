package repo

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
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

// CreateEvent 写入互动事件；同一去重键已存在时复用已有事件（取消点赞后再点赞不重复记事件）
func (r *notificationRepo) CreateEvent(tx *gorm.DB, event *model.InteractionEvent) (*model.InteractionEvent, error) {
	if tx == nil {
		tx = GetDB()
	}
	var existing model.InteractionEvent
	err := tx.Where("dedupe_key = ?", event.DedupeKey).First(&existing).Error
	if err == nil {
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err := tx.Create(event).Error; err != nil {
		// 并发写入同一去重键时以已在库里的为准
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			if err := tx.Where("dedupe_key = ?", event.DedupeKey).First(&existing).Error; err == nil {
				return &existing, nil
			}
		}
		return nil, err
	}
	return event, nil
}

// CreateNotification 写入通知行；(event_id, user_id) 与 (dedupe_key, user_id) 唯一，重复写入直接忽略（幂等）
func (r *notificationRepo) CreateNotification(tx *gorm.DB, notification *model.Notification) error {
	if tx == nil {
		tx = GetDB()
	}
	err := tx.Create(notification).Error
	if err != nil && errors.Is(err, gorm.ErrDuplicatedKey) {
		return nil
	}
	return err
}

// UpsertThreadAggregate 折叠行（comment.thread_replied）：同一天同一线程同一收件人只有一行，
// 后续回复做 count+1、补 actor 名单、刷新 updated_at，并把 read_at 置回 NULL（有新活动就重新变未读）
func (r *notificationRepo) UpsertThreadAggregate(tx *gorm.DB, notification *model.Notification) error {
	if tx == nil {
		tx = GetDB()
	}
	notification.AggregateCount = 1
	for attempt := 0; attempt < 2; attempt++ {
		var existing model.Notification
		err := tx.Where("dedupe_key = ? AND user_id = ?", notification.DedupeKey, notification.UserID).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			err = tx.Create(notification).Error
			if err == nil {
				return nil
			}
			if !errors.Is(err, gorm.ErrDuplicatedKey) {
				return err
			}
			continue // 并发插入：改成更新已有行
		}
		if err != nil {
			return err
		}
		return tx.Model(&model.Notification{}).Where("id = ?", existing.ID).Updates(map[string]any{
			"aggregate_count":  gorm.Expr("aggregate_count + 1"),
			"aggregate_actors": mergeAggregateActors(existing.AggregateActors, notification.AggregateActors),
			"updated_at":       time.Now(),
			"read_at":          nil,
		}).Error
	}
	return nil
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

// DeleteNotificationByEvent 取消点赞时硬删对应的通知行（软删会撞唯一索引，见 4.4）
func (r *notificationRepo) DeleteNotificationByEvent(tx *gorm.DB, eventID, userID uint) error {
	if tx == nil {
		tx = GetDB()
	}
	return tx.Unscoped().Where("event_id = ? AND user_id = ?", eventID, userID).Delete(&model.Notification{}).Error
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
		Order("MAX(created_at) DESC, MAX(id) DESC").
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

// MarkRead 单条已读；若该行属于聚合组则整组一起置已读，返回受影响的条数
func (r *notificationRepo) MarkRead(userID, id uint, timeZone string) (int64, error) {
	var notification model.Notification
	if err := GetDB().Where("id = ? AND user_id = ?", id, userID).First(&notification).Error; err != nil {
		return 0, err
	}
	query := GetDB().Model(&model.Notification{}).Where("user_id = ? AND read_at IS NULL", userID)
	switch {
	case notification.AggregateCount > 0:
		// 折叠行本身就是一组
		query = query.Where("id = ?", notification.ID)
	case isLikeGroupType(notification.Type):
		start, end := notificationDayRange(notification.CreatedAt, timeZone)
		query = query.Where("type = ? AND target_type = ? AND target_id = ? AND created_at >= ? AND created_at < ?",
			notification.Type, notification.TargetType, notification.TargetID, start, end)
	default:
		query = query.Where("id = ?", notification.ID)
	}
	result := query.Update("read_at", time.Now())
	return result.RowsAffected, result.Error
}

// MarkAllRead 全部已读；beforeID 用于避免把请求期间新到的通知也标掉
func (r *notificationRepo) MarkAllRead(userID uint, beforeID *uint) (int64, error) {
	query := GetDB().Model(&model.Notification{}).Where("user_id = ? AND read_at IS NULL", userID)
	if beforeID != nil && *beforeID > 0 {
		query = query.Where("id <= ?", *beforeID)
	}
	result := query.Update("read_at", time.Now())
	return result.RowsAffected, result.Error
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
