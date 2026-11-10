package service

import (
	"context"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

// NotificationService 互动通知的写入入口：抑制判断、去重、生成通知行与邮件状态
type NotificationService struct{}

func NewNotificationService() *NotificationService {
	return &NotificationService{}
}

// NotificationEvent 一条待写入的互动：谁对什么做了什么，收件人是谁
type NotificationEvent struct {
	Type  string      // 见 constant.NotificationType*
	Actor *model.User // 触发者
	Owner *model.User // 收件人：被互动内容的作者

	TargetType string // post / comment：被互动的对象
	TargetID   uint

	SubjectType  string // post / page：互动发生在哪篇文章 / 页面
	SubjectID    uint
	SubjectTitle string
	SubjectSlug  string

	CommentID     uint   // 本次产生的评论（评论 / 回复类事件）
	Excerpt       string // 本次评论正文
	QuotedExcerpt string // 被回复 / 被点赞的那条评论正文

	DedupeKey string // 3.3 的去重键

	// ThreadAggregate 为 true 时这条事件写的是折叠行（comment.thread_replied）：
	// 不存明细，同一线程同一自然日同一收件人只有一行，后续只累加
	ThreadAggregate bool
	// AggregateActor 折叠行里本次触发者的昵称（最多保留前两个）
	AggregateActor string
}

// Emit 写入事件与通知行。tx 非空时与业务写在同一个事务里（5.2 方案 A）。
// 返回的错误由调用方记录日志即可，不能让点赞 / 评论因此失败（5.3）。
// 第二个返回值是收到通知的收件人：非零表示真的产生了通知，调用方应在事务提交后调 NotificationHub.Notify
func (s *NotificationService) Emit(ctx context.Context, tx *gorm.DB, ev *NotificationEvent) (uint, error) {
	if ev == nil || ev.Actor == nil || ev.Owner == nil {
		return 0, nil
	}
	settings := resolveNotificationSettings(ev.Owner.NotificationPrefs, currentNotificationSiteConfig())
	kind := decideNotification(ev.Actor, ev.Owner, ev.Type, settings)
	if kind == notificationKindNone {
		return 0, nil
	}
	at := time.Now()
	event := &model.InteractionEvent{
		Type:          ev.Type,
		ActorID:       ev.Actor.ID,
		OwnerID:       ev.Owner.ID,
		TargetType:    ev.TargetType,
		TargetID:      ev.TargetID,
		SubjectType:   ev.SubjectType,
		SubjectID:     ev.SubjectID,
		SubjectTitle:  truncateRunes(ev.SubjectTitle, notificationSubjectMaxRunes),
		SubjectSlug:   ev.SubjectSlug,
		CommentID:     ev.CommentID,
		Excerpt:       notificationStoredExcerpt(ev.Excerpt),
		QuotedExcerpt: notificationStoredExcerpt(ev.QuotedExcerpt),
		DedupeKey:     ev.DedupeKey,
	}
	event.CreatedAt = at
	// 通知写在业务事务里的一个 savepoint 中：出错只回滚通知本身，评论 / 点赞照常提交（5.3）。
	// Postgres 下事务内任一语句失败都会让整个事务作废，不隔离的话一次通知冲突就会连带评论一起丢失
	if err := withNotificationSavepoint(tx, func(tx *gorm.DB) error {
		return s.writeNotification(tx, ev, event, kind, settings, at)
	}); err != nil {
		return 0, err
	}
	return ev.Owner.ID, nil
}

// writeNotification 写入事件与通知行（普通行或折叠行）
func (s *NotificationService) writeNotification(tx *gorm.DB, ev *NotificationEvent, event *model.InteractionEvent,
	kind string, settings notificationSettings, at time.Time) error {
	stored, err := repo.Notification.CreateEvent(tx, event)
	if err != nil {
		return err
	}

	notification := &model.Notification{
		EventID:       stored.ID,
		UserID:        ev.Owner.ID,
		Type:          ev.Type,
		ActorID:       ev.Actor.ID,
		SubjectType:   ev.SubjectType,
		SubjectID:     ev.SubjectID,
		SubjectTitle:  truncateRunes(ev.SubjectTitle, notificationSubjectMaxRunes),
		SubjectSlug:   ev.SubjectSlug,
		TargetType:    ev.TargetType,
		TargetID:      ev.TargetID,
		CommentID:     ev.CommentID,
		Excerpt:       notificationStoredExcerpt(ev.Excerpt),
		QuotedExcerpt: notificationStoredExcerpt(ev.QuotedExcerpt),
		DedupeKey:     stored.DedupeKey,
		InAppSent:     true, // 站内写库即送达
		EmailState:    notificationEmailState(kind, ev.Type, settings),
	}
	notification.CreatedAt = at
	if notification.EmailState == constant.NotificationEmailStatePending {
		next := at.Add(time.Duration(config.Int("notification_email_interval")) * time.Minute)
		notification.EmailNextAt = &next
	}
	if ev.ThreadAggregate {
		notification.AggregateActors = ev.AggregateActor
		return repo.Notification.UpsertThreadAggregate(tx, notification)
	}
	return repo.Notification.CreateNotification(tx, notification)
}

// withNotificationSavepoint tx 为业务事务时用嵌套事务（SAVEPOINT）包住通知写入，失败时回滚到 savepoint；
// tx 为空时自己开一个事务
func withNotificationSavepoint(tx *gorm.DB, fn func(tx *gorm.DB) error) error {
	if tx == nil {
		tx = repo.GetDB()
	}
	return tx.Transaction(fn)
}

// RevokeLike 取消点赞：硬删对应的通知行（事件保留用于统计，见 3.2 规则 6）。
// 按通知行自己的去重键删除，不经过事件表：事件可能已被保留期清理，经事件反查会漏删
func (s *NotificationService) RevokeLike(ctx context.Context, tx *gorm.DB, actor, owner *model.User, targetType string, targetID uint) error {
	if actor == nil || owner == nil {
		return nil
	}
	var dedupeKey string
	switch targetType {
	case constant.TargetTypePost:
		dedupeKey = dedupeKeyPostLiked(targetID, actor.ID)
	case constant.TargetTypeComment:
		dedupeKey = dedupeKeyCommentLiked(targetID, actor.ID)
	default:
		return nil
	}
	return withNotificationSavepoint(tx, func(tx *gorm.DB) error {
		return repo.Notification.DeleteNotificationByDedupe(tx, dedupeKey, owner.ID)
	})
}
