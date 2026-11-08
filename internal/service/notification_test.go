package service

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func setupNotificationDB(t *testing.T) {
	t.Helper()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
}

func createNotificationUser(t *testing.T, name string, customize func(*model.User)) *model.User {
	t.Helper()
	user := &model.User{Username: name, Nickname: name, Email: name + "@example.com"}
	if customize != nil {
		customize(user)
	}
	if err := repo.GetDB().Create(user).Error; err != nil {
		t.Fatalf("create user %s: %v", name, err)
	}
	return user
}

// 重要消息排队等发信、附带消息挂着搭车、同类互动幂等
func TestEmitNotification(t *testing.T) {
	setupNotificationDB(t)
	// 站点开启通知邮件
	if err := repo.KV.SetKV("notification_email_enable", true); err != nil {
		t.Fatal(err)
	}
	author := createNotificationUser(t, "author", nil)
	commenter := createNotificationUser(t, "commenter", nil)
	fan := createNotificationUser(t, "fan", nil)
	ctx := context.Background()
	service := NewNotificationService()

	comment := &NotificationEvent{
		Type: constant.NotificationTypeCommentCreated, Actor: commenter, Owner: author,
		TargetType: constant.TargetTypePost, TargetID: 12,
		SubjectType: constant.TargetTypePost, SubjectID: 12, SubjectTitle: "标题", SubjectSlug: "slug",
		CommentID: 34, Excerpt: "正文", DedupeKey: dedupeKeyCommentCreated(constant.TargetTypePost, 12, 34),
	}
	if err := service.Emit(ctx, nil, comment); err != nil {
		t.Fatalf("emit comment: %v", err)
	}
	like := &NotificationEvent{
		Type: constant.NotificationTypePostLiked, Actor: fan, Owner: author,
		TargetType: constant.TargetTypePost, TargetID: 12,
		SubjectType: constant.TargetTypePost, SubjectID: 12, SubjectTitle: "标题", SubjectSlug: "slug",
		DedupeKey: dedupeKeyPostLiked(12, fan.ID),
	}
	if err := service.Emit(ctx, nil, like); err != nil {
		t.Fatalf("emit like: %v", err)
	}
	// 重复点赞：通知行不会变成两条
	if err := service.Emit(ctx, nil, like); err != nil {
		t.Fatalf("emit like twice: %v", err)
	}

	var notifications []model.Notification
	if err := repo.GetDB().Order("id").Find(&notifications).Error; err != nil {
		t.Fatal(err)
	}
	if len(notifications) != 2 {
		t.Fatalf("notifications = %d, want 2", len(notifications))
	}
	if notifications[0].EmailState != constant.NotificationEmailStatePending || notifications[0].EmailNextAt == nil {
		t.Fatalf("comment notification should be pending, got %+v", notifications[0])
	}
	if notifications[1].EmailState != constant.NotificationEmailStateAttached || notifications[1].EmailNextAt != nil {
		t.Fatalf("like notification should be attached, got %+v", notifications[1])
	}
	if !notifications[0].InAppSent {
		t.Fatal("in-app should be delivered immediately")
	}
	var events int64
	repo.GetDB().Model(&model.InteractionEvent{}).Count(&events)
	if events != 2 {
		t.Fatalf("events = %d, want 2 (duplicated like reuses its event)", events)
	}

	// 取消点赞：通知硬删，事件保留
	if err := service.RevokeLike(ctx, nil, fan, author, constant.TargetTypePost, 12); err != nil {
		t.Fatalf("revoke like: %v", err)
	}
	var count int64
	repo.GetDB().Model(&model.Notification{}).Count(&count)
	if count != 1 {
		t.Fatalf("notifications after revoke = %d, want 1", count)
	}
	repo.GetDB().Model(&model.InteractionEvent{}).Count(&events)
	if events != 2 {
		t.Fatalf("events after revoke = %d, want 2", events)
	}
}

// 自己互动自己、AI 收件人、禁用用户都不产生通知；关掉 AI 互动后 AI 的评论也不产生
func TestEmitNotificationSuppression(t *testing.T) {
	setupNotificationDB(t)
	author := createNotificationUser(t, "author", nil)
	ctx := context.Background()
	service := NewNotificationService()

	if err := service.Emit(ctx, nil, &NotificationEvent{
		Type: constant.NotificationTypePostLiked, Actor: author, Owner: author,
		TargetType: constant.TargetTypePost, TargetID: 1, DedupeKey: dedupeKeyPostLiked(1, author.ID),
	}); err != nil {
		t.Fatal(err)
	}
	aiOwner := createNotificationUser(t, "aiowner", func(u *model.User) { u.IsAI = true })
	if err := service.Emit(ctx, nil, &NotificationEvent{
		Type: constant.NotificationTypePostLiked, Actor: author, Owner: aiOwner,
		TargetType: constant.TargetTypePost, TargetID: 1, DedupeKey: dedupeKeyPostLiked(1, author.ID),
	}); err != nil {
		t.Fatal(err)
	}
	disabled := createNotificationUser(t, "disabled", func(u *model.User) { u.Disabled = true })
	if err := service.Emit(ctx, nil, &NotificationEvent{
		Type: constant.NotificationTypePostLiked, Actor: author, Owner: disabled,
		TargetType: constant.TargetTypePost, TargetID: 1, DedupeKey: dedupeKeyPostLiked(1, author.ID),
	}); err != nil {
		t.Fatal(err)
	}
	var count int64
	repo.GetDB().Model(&model.Notification{}).Count(&count)
	if count != 0 {
		t.Fatalf("notifications = %d, want 0", count)
	}

	// AI 用户的互动默认算附带；关掉 ai_interactions 后连通知行都不产生
	recipient := createNotificationUser(t, "recipient", nil)
	aiActor := createNotificationUser(t, "ai", func(u *model.User) { u.IsAI = true })
	event := &NotificationEvent{
		Type: constant.NotificationTypeCommentCreated, Actor: aiActor, Owner: recipient,
		TargetType: constant.TargetTypePost, TargetID: 3, CommentID: 8, Excerpt: "AI 的评论",
		DedupeKey: dedupeKeyCommentCreated(constant.TargetTypePost, 3, 8),
	}
	if err := service.Emit(ctx, nil, event); err != nil {
		t.Fatal(err)
	}
	var notification model.Notification
	if err := repo.GetDB().Where("user_id = ?", recipient.ID).First(&notification).Error; err != nil {
		t.Fatalf("AI interaction should create a notification by default: %v", err)
	}
	if notification.EmailState != constant.NotificationEmailStateSkipped && notification.EmailState != constant.NotificationEmailStateAttached {
		t.Fatalf("AI interaction should never be pending, got %s", notification.EmailState)
	}
	// 关掉开关后换一条事件，通知行不再产生
	recipient.NotificationPrefs = `{"inapp":["comment.created","comment.replied","post.liked","comment.liked","comment.thread_replied"],"email":[],"ai_interactions":false}`
	if err := repo.GetDB().Model(&model.User{}).Where("id = ?", recipient.ID).Update("notification_prefs", recipient.NotificationPrefs).Error; err != nil {
		t.Fatal(err)
	}
	updated, err := repo.User.GetUserByID(recipient.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Emit(ctx, nil, &NotificationEvent{
		Type: constant.NotificationTypeCommentCreated, Actor: aiActor, Owner: updated,
		TargetType: constant.TargetTypePost, TargetID: 3, CommentID: 9, Excerpt: "第二条",
		DedupeKey: dedupeKeyCommentCreated(constant.TargetTypePost, 3, 9),
	}); err != nil {
		t.Fatal(err)
	}
	repo.GetDB().Model(&model.Notification{}).Where("user_id = ?", recipient.ID).Count(&count)
	if count != 1 {
		t.Fatalf("notifications after muting AI = %d, want 1", count)
	}
}

// 折叠行：同一天同一线程同一收件人只留一行，count 累加
func TestEmitNotificationThreadAggregate(t *testing.T) {
	setupNotificationDB(t)
	threadStarter := createNotificationUser(t, "starter", nil)
	first := createNotificationUser(t, "first", nil)
	second := createNotificationUser(t, "second", nil)
	ctx := context.Background()
	service := NewNotificationService()
	day := notificationDay(time.Now(), threadStarter.TimeZone)

	for _, actor := range []*model.User{first, second} {
		if err := service.Emit(ctx, nil, &NotificationEvent{
			Type: constant.NotificationTypeCommentThreadReplied, Actor: actor, Owner: threadStarter,
			TargetType: constant.TargetTypeComment, TargetID: 5, CommentID: 5,
			SubjectType: constant.TargetTypePost, SubjectID: 12, SubjectTitle: "文章",
			DedupeKey:       dedupeKeyThreadReplied(5, day, threadStarter.ID),
			ThreadAggregate: true,
			AggregateActor:  actor.Nickname,
		}); err != nil {
			t.Fatal(err)
		}
	}
	var rows []model.Notification
	if err := repo.GetDB().Where("user_id = ?", threadStarter.ID).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("folded rows = %d, want 1", len(rows))
	}
	if rows[0].AggregateCount != 2 || rows[0].AggregateActors != "first,second" {
		t.Fatalf("folded row = %+v", rows[0])
	}
	if rows[0].EmailState != constant.NotificationEmailStateAttached && rows[0].EmailState != constant.NotificationEmailStateSkipped {
		t.Fatalf("thread activity must never queue an email, got %s", rows[0].EmailState)
	}
}

// 点赞走完整链路：点赞写事件与通知，取消点赞硬删通知，连续切换只留一条
func TestToggleLikeEmitsNotification(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	authorID, _ := ctxutils.GetCurrentUserID(author)
	otherID, _ := ctxutils.GetCurrentUserID(other)
	postID := createPublicPost(t, author, nil)

	liked, svcerr := NewLikeService().ToggleLike(other, postID, constant.TargetTypePost, nil)
	if svcerr != nil || !liked {
		t.Fatalf("like: %v", svcerr)
	}
	var notifications []model.Notification
	if err := repo.GetDB().Where("user_id = ?", authorID).Find(&notifications).Error; err != nil {
		t.Fatal(err)
	}
	if len(notifications) != 1 {
		t.Fatalf("notifications = %d, want 1", len(notifications))
	}
	if notifications[0].Type != constant.NotificationTypePostLiked || notifications[0].ActorID != otherID {
		t.Fatalf("unexpected notification: %+v", notifications[0])
	}
	if notifications[0].SubjectTitle != "public" {
		t.Fatalf("subject title snapshot = %q", notifications[0].SubjectTitle)
	}

	// 取消点赞：通知硬删（连 Unscoped 也查不到），事件保留
	if liked, svcerr = NewLikeService().ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil || liked {
		t.Fatalf("unlike: %v", svcerr)
	}
	var count int64
	repo.GetDB().Model(&model.Notification{}).Where("user_id = ?", authorID).Count(&count)
	if count != 0 {
		t.Fatalf("notifications after unlike = %d", count)
	}
	repo.GetDB().Model(&model.InteractionEvent{}).Count(&count)
	if count != 1 {
		t.Fatalf("events after unlike = %d, want the event kept", count)
	}

	// 再点一次：复用同一条事件，通知仍然只有一条
	if _, svcerr = NewLikeService().ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil {
		t.Fatalf("like again: %v", svcerr)
	}
	repo.GetDB().Model(&model.Notification{}).Where("user_id = ?", authorID).Count(&count)
	if count != 1 {
		t.Fatalf("notifications after re-like = %d", count)
	}
	repo.GetDB().Model(&model.InteractionEvent{}).Count(&count)
	if count != 1 {
		t.Fatalf("events after re-like = %d, want 1", count)
	}
}

// 通知写入失败不影响点赞本身：把通知表改名让 Emit 必然失败
func TestToggleLikeSurvivesNotificationFailure(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	if err := repo.GetDB().Migrator().DropTable(&model.Notification{}); err != nil {
		t.Fatalf("drop notifications: %v", err)
	}
	liked, svcerr := NewLikeService().ToggleLike(other, postID, constant.TargetTypePost, nil)
	if svcerr != nil {
		t.Fatalf("like should survive notification failure: %v", svcerr)
	}
	if !liked {
		t.Fatal("like state lost")
	}
	var count int64
	repo.GetDB().Model(&model.Like{}).Count(&count)
	if count != 1 {
		t.Fatalf("likes = %d, want 1", count)
	}
}

// 评论链路：根评论通知作者、回复通知被回复人、线程活动通知线程发起人（同一天折叠成一行）
func TestCommentNotifications(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	authorID, _ := ctxutils.GetCurrentUserID(author)
	adminID, _ := ctxutils.GetCurrentUserID(admin)
	otherID, _ := ctxutils.GetCurrentUserID(other)
	postID := createPublicPost(t, author, nil)
	notificationsOf := func(userID uint) []model.Notification {
		t.Helper()
		var rows []model.Notification
		if err := repo.GetDB().Where("user_id = ?", userID).Order("id").Find(&rows).Error; err != nil {
			t.Fatal(err)
		}
		return rows
	}

	// 1. 根评论 → 文章作者收到 comment.created
	rootID, svcerr := createComment(other, postID, 0, false)
	if svcerr != nil {
		t.Fatalf("root comment: %v", svcerr)
	}
	rows := notificationsOf(authorID)
	if len(rows) != 1 || rows[0].Type != constant.NotificationTypeCommentCreated {
		t.Fatalf("author notifications = %+v", rows)
	}
	if rows[0].SubjectTitle != "public" || rows[0].CommentID != rootID {
		t.Fatalf("unexpected snapshot: %+v", rows[0])
	}

	// 2. 作者回复 other 的评论 → other 收到 comment.replied
	authorReplyID, svcerr := createComment(author, postID, rootID, false)
	if svcerr != nil {
		t.Fatalf("reply: %v", svcerr)
	}
	rows = notificationsOf(otherID)
	if len(rows) != 1 || rows[0].Type != constant.NotificationTypeCommentReplied {
		t.Fatalf("other notifications = %+v", rows)
	}
	if rows[0].QuotedExcerpt != "c" {
		t.Fatalf("quoted excerpt = %q", rows[0].QuotedExcerpt)
	}

	// 3. admin 回复作者的那条回复 → 作者收到 comment.replied，线程发起人 other 收到线程活动；
	//    直接父评论作者（作者）已经收过回复通知，不再重复收线程活动
	if _, svcerr := createComment(admin, postID, authorReplyID, false); svcerr != nil {
		t.Fatalf("thread reply: %v", svcerr)
	}
	var folded int
	for _, row := range notificationsOf(otherID) {
		if row.Type == constant.NotificationTypeCommentThreadReplied {
			folded++
			if row.AggregateCount != 1 || row.AggregateActors == "" {
				t.Fatalf("folded row = %+v", row)
			}
		}
	}
	if folded != 1 {
		t.Fatalf("thread rows for the starter = %d, want 1", folded)
	}
	var authorThread int
	for _, row := range notificationsOf(authorID) {
		if row.Type == constant.NotificationTypeCommentThreadReplied {
			authorThread++
		}
	}
	if authorThread != 0 {
		t.Fatalf("parent author should not get a duplicated thread row, got %d", authorThread)
	}

	// 4. 再回复一次同一条 → 折叠行累加而不是新增
	if _, svcerr := createComment(admin, postID, authorReplyID, false); svcerr != nil {
		t.Fatalf("second thread reply: %v", svcerr)
	}
	var foldedRows []model.Notification
	repo.GetDB().Where("user_id = ? AND type = ?", otherID, constant.NotificationTypeCommentThreadReplied).Find(&foldedRows)
	if len(foldedRows) != 1 || foldedRows[0].AggregateCount != 2 {
		t.Fatalf("folded rows = %+v", foldedRows)
	}
	_ = adminID
}

// 越权读取别人的通知返回 404，未登录返回 401；一键已读只影响 before_id 之前的行
func TestNotificationReadPermissions(t *testing.T) {
	setupNotificationDB(t)
	owner := createNotificationUser(t, "owner", nil)
	other := createNotificationUser(t, "other", nil)
	service := NewNotificationService()
	ownerCtx := context.WithValue(context.Background(), "user_id", owner.ID)

	makeRow := func(actorID uint, suffix string) *model.Notification {
		event, err := repo.Notification.CreateEvent(nil, &model.InteractionEvent{
			Type: constant.NotificationTypePostLiked, ActorID: actorID, OwnerID: owner.ID, DedupeKey: "test:" + suffix,
		})
		if err != nil {
			t.Fatal(err)
		}
		notification := &model.Notification{
			EventID: event.ID,
			UserID:  owner.ID, ActorID: actorID, Type: constant.NotificationTypePostLiked,
			SubjectType: constant.TargetTypePost, SubjectID: 1, TargetType: constant.TargetTypePost, TargetID: 1,
			DedupeKey: "test:" + suffix,
		}
		if err := repo.Notification.CreateNotification(nil, notification); err != nil {
			t.Fatal(err)
		}
		return notification
	}
	first := makeRow(other.ID, "a")
	second := makeRow(other.ID, "b")

	// 未登录
	if _, _, svcerr := service.ListNotifications(context.Background(), &dto.ListNotificationsReq{}); svcerr == nil || svcerr.Code != 401 {
		t.Fatalf("anonymous list = %v, want 401", svcerr)
	}
	// 别人的通知：404 而不是 403，不暴露存在性
	otherCtx := context.WithValue(context.Background(), "user_id", other.ID)
	if _, svcerr := service.MarkNotificationRead(otherCtx, first.ID); svcerr == nil || svcerr.Code != 404 {
		t.Fatalf("reading someone else's notification = %v, want 404", svcerr)
	}

	// before_id 只标到该行
	before := first.ID
	affected, svcerr := service.MarkAllNotificationsRead(ownerCtx, &dto.MarkAllNotificationsReadReq{BeforeID: &before})
	if svcerr != nil {
		t.Fatalf("mark all: %v", svcerr)
	}
	if affected != 1 {
		t.Fatalf("affected = %d, want 1", affected)
	}
	var unread int64
	repo.GetDB().Model(&model.Notification{}).Where("user_id = ? AND read_at IS NULL", owner.ID).Count(&unread)
	if unread != 1 {
		t.Fatalf("unread = %d, want the newer row still unread", unread)
	}
	// 幂等：再标一次没有影响
	if affected, svcerr = service.MarkNotificationRead(ownerCtx, second.ID); svcerr != nil || affected != 1 {
		t.Fatalf("mark read = %d, %v", affected, svcerr)
	}
	if affected, svcerr = service.MarkNotificationRead(ownerCtx, second.ID); svcerr != nil || affected != 0 {
		t.Fatalf("mark read twice = %d, %v", affected, svcerr)
	}
}

// 偏好：邮件类型只能落在站点白名单内，一键退订清空邮件列表但保留站内；测试通知不产生未读以外的副作用
func TestNotificationPreferences(t *testing.T) {
	setupNotificationDB(t)
	user := createNotificationUser(t, "prefuser", nil)
	userCtx := context.WithValue(context.Background(), "user_id", user.ID)
	service := NewNotificationService()

	prefs, svcerr := service.GetNotificationPreferences(userCtx)
	if svcerr != nil {
		t.Fatalf("get preferences: %v", svcerr)
	}
	if !prefs.AIInteractions || len(prefs.InApp) != len(notificationAllTypes) {
		t.Fatalf("defaults = %+v", prefs)
	}

	// 试图打开站点没开的类型（点赞永远不会进邮件白名单）会被裁掉
	aiOff := false
	saved, svcerr := service.UpdateNotificationPreferences(userCtx, &dto.UpdateNotificationPreferencesReq{
		InApp:          []string{constant.NotificationTypeCommentCreated, constant.NotificationTypePostLiked, "unknown"},
		Email:          []string{constant.NotificationTypePostLiked, constant.NotificationTypeCommentReplied},
		AIInteractions: &aiOff,
	})
	if svcerr != nil {
		t.Fatalf("update preferences: %v", svcerr)
	}
	if len(saved.InApp) != 2 || len(saved.Email) != 1 || saved.Email[0] != constant.NotificationTypeCommentReplied {
		t.Fatalf("saved = %+v", saved)
	}
	if saved.AIInteractions {
		t.Fatal("ai_interactions should be saved")
	}

	// 一键退订：邮件列表清空，站内保持
	unsubscribed, svcerr := service.UnsubscribeAllNotifications(userCtx)
	if svcerr != nil {
		t.Fatalf("unsubscribe all: %v", svcerr)
	}
	if len(unsubscribed.Email) != 0 || len(unsubscribed.InApp) != 2 {
		t.Fatalf("after unsubscribe = %+v", unsubscribed)
	}

	// 测试通知：管理员给自己发一条，别人看不到
	if svcerr := service.SendTestNotification(userCtx); svcerr != nil {
		t.Fatalf("send test notification: %v", svcerr)
	}
	items, total, svcerr := service.ListNotifications(userCtx, &dto.ListNotificationsReq{})
	if svcerr != nil {
		t.Fatalf("list after test: %v", svcerr)
	}
	if total != 1 || len(items) != 1 || items[0].Type != "system.test" {
		t.Fatalf("test notification not visible: %d/%d", total, len(items))
	}
}
