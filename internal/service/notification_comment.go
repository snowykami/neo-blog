package service

import (
	"context"
	"slices"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

// emitCommentNotifications 一条新评论产生的三类通知（3.1 / 3.2）：
//  1. 根评论 → comment.created 给文章 / 页面作者
//  2. 回复 → comment.replied 给被回复评论的作者（逐条，不折叠）
//  3. 回复 → comment.thread_replied 给线程发起人与主题作者（折叠行，排除 actor 与直接父评论作者）
//
// 与评论写在同一个事务里；调用方负责把错误只记日志，不让评论失败（5.3）
func emitCommentNotifications(ctx context.Context, tx *gorm.DB, actor *model.User, comment *model.Comment, parent *model.Comment, target *commentTarget) ([]uint, error) {
	subjectTitle, subjectSlug := commentSubject(comment)
	excerpt := commentExcerpt(comment)
	notifications := NewNotificationService()
	var firstErr error
	// notifiedUsers 事务提交后需要推送实时通知的收件人
	notifiedUsers := make([]uint, 0, 2)
	record := func(userID uint, err error) {
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			return
		}
		if userID != 0 {
			notifiedUsers = append(notifiedUsers, userID)
		}
	}
	// 已经收到评论 / 回复通知的人不再重复收线程活动通知
	notified := map[uint]bool{}

	if comment.ReplyID == 0 {
		owner, err := repo.User.GetUserByID(target.ownerID)
		if err != nil {
			return notifiedUsers, err
		}
		notified[owner.ID] = true
		record(notifications.Emit(ctx, tx, &NotificationEvent{
			Type: constant.NotificationTypeCommentCreated, Actor: actor, Owner: owner,
			TargetType: comment.TargetType, TargetID: comment.TargetID,
			SubjectType: comment.TargetType, SubjectID: comment.TargetID,
			SubjectTitle: subjectTitle, SubjectSlug: subjectSlug,
			CommentID: comment.ID, Excerpt: excerpt,
			DedupeKey: dedupeKeyCommentCreated(comment.TargetType, comment.TargetID, comment.ID),
		}))
		// 根评论也要把被 @ 的人叫来（评论通知与提及通知互不替代）
		notifiedUsers = append(notifiedUsers, emitCommentMentions(ctx, tx, actor, comment, target, subjectTitle, subjectSlug, excerpt, notified)...)
		return notifiedUsers, firstErr
	}
	if parent == nil {
		return notifiedUsers, nil
	}
	// 规则 7：回复只通知被回复人
	replied, err := repo.User.GetUserByID(parent.UserID)
	if err != nil {
		return notifiedUsers, err
	}
	notified[replied.ID] = true
	record(notifications.Emit(ctx, tx, &NotificationEvent{
		Type: constant.NotificationTypeCommentReplied, Actor: actor, Owner: replied,
		TargetType: constant.TargetTypeComment, TargetID: parent.ID,
		SubjectType: comment.TargetType, SubjectID: comment.TargetID,
		SubjectTitle: subjectTitle, SubjectSlug: subjectSlug,
		CommentID: comment.ID, Excerpt: excerpt, QuotedExcerpt: parent.Content,
		DedupeKey: dedupeKeyCommentReplied(parent.ID, comment.ID),
	}))

	// 被 @ 的人：真人直接点名，按重要消息处理（触发邮件）；已收到回复通知的人不重复发
	mentionNotified := emitCommentMentions(ctx, tx, actor, comment, target, subjectTitle, subjectSlug, excerpt, notified)
	notifiedUsers = append(notifiedUsers, mentionNotified...)
	for _, id := range mentionNotified {
		notified[id] = true
	}

	// 规则 8：线程活动只给线程发起人与主题作者，同一天同一线程同一收件人折叠成一行
	rootID := comment.RootID
	if rootID == 0 {
		return notifiedUsers, firstErr
	}
	root, err := repo.Comment.GetComment(rootID)
	if err != nil {
		// 线程根已被删除：没有收件人可算，直接结束
		return notifiedUsers, firstErr
	}
	recipientIDs := []uint{root.UserID}
	if config.Bool("notification_thread_include_author") {
		recipientIDs = append(recipientIDs, target.ownerID)
	}
	actorName := notificationActorName(actor)
	for _, recipientID := range recipientIDs {
		if recipientID == actor.ID || notified[recipientID] {
			continue
		}
		recipient, err := repo.User.GetUserByID(recipientID)
		if err != nil {
			continue
		}
		notified[recipientID] = true
		record(notifications.Emit(ctx, tx, &NotificationEvent{
			Type: constant.NotificationTypeCommentThreadReplied, Actor: actor, Owner: recipient,
			TargetType: constant.TargetTypeComment, TargetID: rootID,
			SubjectType: comment.TargetType, SubjectID: comment.TargetID,
			SubjectTitle: subjectTitle, SubjectSlug: subjectSlug,
			CommentID:       rootID,
			DedupeKey:       dedupeKeyThreadReplied(rootID, notificationDay(comment.CreatedAt, recipient.TimeZone), recipient.ID),
			ThreadAggregate: true,
			AggregateActor:  actorName,
		}))
	}
	return notifiedUsers, firstErr
}

// commentSubject 评论所在文章 / 页面的标题与 slug（标题被改过时通知里仍是当时的快照）
func commentSubject(comment *model.Comment) (string, string) {
	briefs, err := repo.Comment.ListTargetBriefs(comment.TargetType, []uint{comment.TargetID})
	if err != nil {
		logrus.Errorf("comment subject briefs: %v", err)
		return "", ""
	}
	brief, ok := briefs[comment.TargetID]
	if !ok {
		return "", ""
	}
	return brief.Title, derefString(brief.Slug)
}

// commentExcerpt 通知里显示的正文：纯附件评论存一个与语言无关的占位标记（见 15.4），
// 站内列表与邮件按收件人的语言渲染成「[图片 ×3]」之类的文字，见 NotificationAttachmentMarker
func commentExcerpt(comment *model.Comment) string {
	if strings.TrimSpace(comment.Content) != "" {
		return comment.Content
	}
	if len(comment.AttachmentIDs) == 0 {
		return ""
	}
	files, err := repo.File.ListByIDs(comment.AttachmentIDs)
	if err != nil {
		logrus.Errorf("comment attachment files: %v", err)
		return NotificationAttachmentMarker(notificationAttachmentFile, 1)
	}
	images := 0
	for _, file := range files {
		if strings.HasPrefix(file.MimeType, "image/") {
			images++
		}
	}
	switch {
	case len(files) == 0:
		return NotificationAttachmentMarker(notificationAttachmentFile, 1)
	case images == len(files):
		return NotificationAttachmentMarker(notificationAttachmentImage, len(files))
	default:
		return NotificationAttachmentMarker(notificationAttachmentFile, len(files))
	}
}

// notificationActorName 通知里的称呼：昵称优先，其次用户名，超长截断
func notificationActorName(user *model.User) string {
	if user == nil {
		return ""
	}
	name := strings.TrimSpace(user.Nickname)
	if name == "" {
		name = user.Username
	}
	return truncateRunes(name, notificationActorMaxRunes)
}

// itoaRunes 小整数转字符串，避免为一处格式化引入额外依赖
func itoaRunes(value int) string {
	if value == 0 {
		return "0"
	}
	digits := make([]byte, 0, 4)
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}

// emitCommentMentions 给被 @ 的人写通知，返回成功写入的收件人；
// skip 里已经收到评论 / 回复通知的人不再重复（同一条评论只提醒一次）
func emitCommentMentions(ctx context.Context, tx *gorm.DB, actor *model.User, comment *model.Comment, target *commentTarget,
	subjectTitle, subjectSlug, excerpt string, skip map[uint]bool) []uint {
	if len(comment.MentionUserIDs) == 0 {
		return nil
	}
	ids := []uint(comment.MentionUserIDs)
	// 私密评论只通知目标作者与参与过该线程的人
	if comment.IsPrivate {
		ids = filterMentionRecipients(ids, target.ownerID, comment.RootID)
	}
	notifications := NewNotificationService()
	notified := make([]uint, 0, len(ids))
	for _, recipientID := range ids {
		if recipientID == actor.ID || skip[recipientID] {
			continue
		}
		recipient, err := repo.User.GetUserByID(recipientID)
		if err != nil {
			continue
		}
		if _, err := notifications.Emit(ctx, tx, &NotificationEvent{
			Type: constant.NotificationTypeCommentMentioned, Actor: actor, Owner: recipient,
			TargetType: constant.TargetTypeComment, TargetID: comment.ID,
			SubjectType: comment.TargetType, SubjectID: comment.TargetID,
			SubjectTitle: subjectTitle, SubjectSlug: subjectSlug,
			CommentID: comment.ID, Excerpt: excerpt,
			DedupeKey: dedupeKeyCommentMentioned(comment.ID, recipientID),
		}); err != nil {
			logrus.Errorf("emit comment mention: %v", err)
			continue
		}
		notified = append(notified, recipientID)
	}
	return notified
}

// syncCommentNotificationsAfterEdit 评论编辑后同步通知，返回需要推送的收件人（调用方在写库后推送）：
//  1. 公开改为私密：收回看不到这条私密评论的人收到的通知（评论、回复、提及都带着正文快照）。
//     选择直接删除而不是在发信前复核可见性：站内列表同样会露出正文快照，只拦邮件不够
//  2. 新加的 @：按与发表评论时相同的规则补发提及通知；去重键与发表时一致，重复编辑不会重复通知
//
// 通知是附属品：任何一步失败只记日志，不让编辑失败（5.3）
func syncCommentNotificationsAfterEdit(ctx context.Context, comment *model.Comment, wasPrivate bool, previousMentions []uint) []uint {
	target, svcerr := NewCommentService().getTarget(comment.TargetID, comment.TargetType)
	if svcerr != nil {
		return nil
	}
	var notified []uint
	if comment.IsPrivate && !wasPrivate {
		revoked, err := revokeHiddenCommentNotifications(comment, target)
		if err != nil {
			logrus.Errorf("revoke notifications of private comment %d: %v", comment.ID, err)
		}
		notified = append(notified, revoked...)
	}

	var added []uint
	for _, id := range comment.MentionUserIDs {
		if !slices.Contains(previousMentions, id) {
			added = append(added, id)
		}
	}
	if len(added) == 0 {
		return notified
	}
	// 提及以评论作者的名义发出（管理员代为编辑时也是）
	actor, err := repo.User.GetUserByID(comment.UserID)
	if err != nil {
		logrus.Errorf("load comment author %d: %v", comment.UserID, err)
		return notified
	}
	// 与发表时一致：已经因这条评论收到评论 / 回复通知的人不再收提及
	skip := map[uint]bool{}
	if comment.ReplyID == 0 {
		skip[target.ownerID] = true
	} else if parent, err := repo.Comment.GetComment(comment.ReplyID); err == nil {
		skip[parent.UserID] = true
	}
	edited := *comment
	edited.MentionUserIDs = added
	subjectTitle, subjectSlug := commentSubject(comment)
	notified = append(notified, emitCommentMentions(ctx, nil, actor, &edited, target, subjectTitle, subjectSlug, commentExcerpt(comment), skip)...)
	return notified
}

// revokeHiddenCommentNotifications 删除引用这条（已改为私密的）评论、但收件人看不到它的通知，返回被删通知的收件人。
// 能看到私密评论的人与 canViewComment 一致：目标作者、管理员、评论作者、参与过该线程的人
func revokeHiddenCommentNotifications(comment *model.Comment, target *commentTarget) ([]uint, error) {
	rows, err := repo.Notification.ListByCommentID(comment.ID)
	if err != nil {
		return nil, err
	}
	visible := map[uint]bool{}
	var hidden []uint
	for _, row := range rows {
		canView, checked := visible[row.UserID]
		if !checked {
			canView, err = canUserViewPrivateComment(row.UserID, comment, target)
			if err != nil {
				return nil, err
			}
			visible[row.UserID] = canView
		}
		if !canView {
			hidden = append(hidden, row.ID)
		}
	}
	return repo.Notification.DeleteByIDs(nil, hidden)
}

// canUserViewPrivateComment 某个用户（不是当前请求的用户）能否看到这条私密评论，规则同 canViewComment
func canUserViewPrivateComment(userID uint, comment *model.Comment, target *commentTarget) (bool, error) {
	if userID == target.ownerID || userID == comment.UserID {
		return true, nil
	}
	user, err := repo.User.GetUserByID(userID)
	if err != nil {
		// 用户已不存在：通知没有意义，一并收回
		return false, nil
	}
	if user.IsAdmin() {
		return true, nil
	}
	return repo.Comment.HasUserCommentedInTree(comment.RootID, userID)
}
