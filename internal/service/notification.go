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
// 返回的错误由调用方记录日志即可，不能让点赞 / 评论因此失败（5.3）
func (s *NotificationService) Emit(ctx context.Context, tx *gorm.DB, ev *NotificationEvent) error {
	if ev == nil || ev.Actor == nil || ev.Owner == nil {
		return nil
	}
	settings := resolveNotificationSettings(ev.Owner.NotificationPrefs, currentNotificationSiteConfig())
	kind := decideNotification(ev.Actor, ev.Owner, ev.Type, settings)
	if kind == notificationKindNone {
		return nil
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

// RevokeLike 取消点赞：硬删对应的通知行（事件保留用于统计，见 3.2 规则 6）
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
	event, err := repo.Notification.GetEventByDedupeKey(dedupeKey)
	if err != nil {
		// 没有对应事件说明当时没有产生通知，直接结束
		return nil
	}
	return repo.Notification.DeleteNotificationByEvent(tx, event.ID, owner.ID)
}
