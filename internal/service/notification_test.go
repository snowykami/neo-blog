package service

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"

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
