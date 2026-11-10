package model

import (
	"time"

	"gorm.io/gorm"
)

// InteractionEvent 互动事件：谁对什么做了什么，与收件人无关。
// 快照字段（标题、正文摘要）让通知列表与邮件都不必回查业务表，目标被删除后也还能显示发生了什么
type InteractionEvent struct {
	gorm.Model
	Type    string `gorm:"size:32;index"` // 见 constant.NotificationType*
	ActorID uint   `gorm:"index"`         // 触发者
	Actor   User   `gorm:"foreignKey:ActorID"`
	OwnerID uint   `gorm:"index"` // 内容作者，v1 的唯一收件人
	// post / comment：被互动的对象
	TargetType string `gorm:"size:16"`
	TargetID   uint
	// post / page：互动发生在哪篇文章 / 页面，列表与邮件据此跳转
	SubjectType   string `gorm:"size:16"`
	SubjectID     uint
	SubjectTitle  string `gorm:"size:255"`
	SubjectSlug   string `gorm:"size:255"`
	CommentID     uint   // 本次产生的评论（评论 / 回复类事件）
	Excerpt       string `gorm:"size:300"` // 本次评论的正文快照
	QuotedExcerpt string `gorm:"size:300"` // 被回复 / 被点赞的那条评论正文快照
	// 同一 actor + 动作 + 目标只保留一条事件，避免反复点赞 / 取消刷出多条通知
	DedupeKey string `gorm:"size:160;uniqueIndex:idx_interaction_event_dedupe"`
}

// Notification 通知：事件 × 收件人，带该收件人的已读与投递状态
type Notification struct {
	gorm.Model
	EventID uint `gorm:"uniqueIndex:idx_notification_event_user"`
	// user_id 参与两个唯一索引：事件 × 收件人的幂等、折叠行的 upsert 键
	// 另参与 (user_id, activity_at) 组合索引：通知列表按最近活动时间倒序
	UserID uint   `gorm:"uniqueIndex:idx_notification_event_user;uniqueIndex:idx_notification_dedupe;index:idx_notification_user_activity,priority:1"`
	Type   string `gorm:"size:32;index"` // 冗余事件类型，列表筛选不必 join

	// 冗余快照：列表渲染不 join 事件表，目标被删除时不至于空白
	ActorID       uint
	Actor         User   `gorm:"foreignKey:ActorID"`
	SubjectType   string `gorm:"size:16"`
	SubjectID     uint
	SubjectTitle  string `gorm:"size:255"`
	SubjectSlug   string `gorm:"size:255"`
	TargetType    string `gorm:"size:16"`
	TargetID      uint
	CommentID     uint
	Excerpt       string `gorm:"size:300"`
	QuotedExcerpt string `gorm:"size:300"`

	// 折叠行：只有 comment.thread_replied 用。点赞类靠明细行在渲染时归并，不写这几列。
	// dedupe_key 在所有行上都写入（等于事件的去重键），(dedupe_key, user_id) 唯一索引同时充当散文幂等与折叠行 upsert 键
	DedupeKey       string `gorm:"size:200;uniqueIndex:idx_notification_dedupe"` // 事件去重键；折叠行另含自然日
	AggregateCount  int    `gorm:"default:0"`                                    // 0 = 普通行；折叠行插入时置 1，每来一条 +1
	AggregateActors string `gorm:"size:120"`                                     // 前 2 个昵称，逗号分隔，用于「A、B 和另外 N 人」

	// ActivityAt 最近一次活动时间，列表按它排序：普通行等于 created_at，折叠行每来一条回复刷新一次。
	// 不用 updated_at：已读、邮件状态这些与活动无关的更新也会刷新它
	ActivityAt time.Time `gorm:"index:idx_notification_user_activity,priority:2"`

	ReadAt    *time.Time // 为空即未读；未读单位是聚合行而非单条
	InAppSent bool       `gorm:"default:false"`

	// 邮件渠道状态机：pending → sending → sent / failed / skipped；附带行是 attached，永远不会被扫表命中
	EmailState    string     `gorm:"size:16;default:pending;index:idx_notification_email_due"`
	EmailAttempts int        `gorm:"default:0"`
	EmailNextAt   *time.Time `gorm:"index:idx_notification_email_due"`
	EmailSentAt   *time.Time
	EmailLastErr  string `gorm:"size:255"` // 失败原因；skipped 时记录跳过原因（skip:read 等）
	// EmailClaimedAt 进入 sending 的时间：发信实例中途退出时，超时仍停在 sending 的行由 worker 收回重发
	EmailClaimedAt *time.Time
}

// NotificationPrefs 用户的渠道偏好，存在 users.notification_prefs 里（JSON 文本，空表示全默认）
type NotificationPrefs struct {
	InApp          []string `json:"inapp"`           // 允许的站内通知类型
	Email          []string `json:"email"`           // 允许的邮件类型，只能取站点级白名单的子集
	AIInteractions bool     `json:"ai_interactions"` // 关掉后 AI 用户的互动连通知行都不产生
}

// BeforeCreate 没有显式给出最近活动时间时取创建时间，保证列表排序键不为空
func (n *Notification) BeforeCreate(*gorm.DB) error {
	if n.ActivityAt.IsZero() {
		if n.CreatedAt.IsZero() {
			n.CreatedAt = time.Now()
		}
		n.ActivityAt = n.CreatedAt
	}
	return nil
}
