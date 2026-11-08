package tasks

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
	"github.com/snowykami/neo-blog/pkg/utils"
)

func setupNotificationEmailDB(t *testing.T) {
	t.Helper()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	if err := repo.KV.SetKV("notification_email_enable", true); err != nil {
		t.Fatal(err)
	}
}

// sentMail 记录一次发信的收件人与正文，用来断言 worker 的行为
type sentMail struct {
	to      string
	subject string
	html    string
}

func stubEmailSender(t *testing.T) *[]sentMail {
	t.Helper()
	sent := &[]sentMail{}
	original := sendNotificationEmail
	sendNotificationEmail = func(_ *utils.EmailConfig, to, subject, html string, _ map[string]string) error {
		*sent = append(*sent, sentMail{to: to, subject: subject, html: html})
		return nil
	}
	t.Cleanup(func() { sendNotificationEmail = original })
	return sent
}

func createEmailUser(t *testing.T, name, language string) *model.User {
	t.Helper()
	user := &model.User{Username: name, Nickname: name, Email: name + "@example.com", Language: language}
	if err := repo.GetDB().Create(user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return user
}

// addNotification 直接写一条通知行，state 决定它是重要行（pending）还是附带行（attached）
func addNotification(t *testing.T, owner, actor *model.User, eventType, state string, at time.Time) *model.Notification {
	t.Helper()
	dedupeKey := eventType + ":" + at.Format(time.RFC3339Nano)
	event := &model.InteractionEvent{
		Type: eventType, ActorID: actor.ID, OwnerID: owner.ID, DedupeKey: dedupeKey,
	}
	event.CreatedAt = at
	event, err := repo.Notification.CreateEvent(nil, event)
	if err != nil {
		t.Fatal(err)
	}
	notification := &model.Notification{
		EventID: event.ID, UserID: owner.ID, ActorID: actor.ID, Type: eventType,
		SubjectType: constant.TargetTypePost, SubjectID: 12, SubjectTitle: "标题", SubjectSlug: "slug",
		TargetType: constant.TargetTypePost, TargetID: 12, CommentID: 34, Excerpt: "正文",
		DedupeKey: dedupeKey, EmailState: state,
	}
	notification.CreatedAt = at
	if state == constant.NotificationEmailStatePending {
		due := at
		notification.EmailNextAt = &due
	}
	if err := repo.Notification.CreateNotification(nil, notification); err != nil {
		t.Fatal(err)
	}
	return notification
}

// 只有到期的「重要」通知会触发发信，附带行搭同一封的车，超上限的只给一句「另有 N 个赞」
func TestSendNotificationEmails(t *testing.T) {
	setupNotificationEmailDB(t)
	sent := stubEmailSender(t)
	recipient := createEmailUser(t, "owner", "zh")
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	// 两条重要通知 + 3 条点赞 + 1 条线程活动
	addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-20*time.Minute))
	addNotification(t, recipient, actor, constant.NotificationTypeCommentReplied, constant.NotificationEmailStatePending, now.Add(-10*time.Minute))
	for i := 0; i < 3; i++ {
		addNotification(t, recipient, actor, constant.NotificationTypePostLiked, constant.NotificationEmailStateAttached, now.Add(-time.Duration(i+1)*time.Minute))
	}
	addNotification(t, recipient, actor, constant.NotificationTypeCommentThreadReplied, constant.NotificationEmailStateAttached, now.Add(-2*time.Minute))

	if err := sendNotificationEmails(now); err != nil {
		t.Fatalf("send: %v", err)
	}
	if len(*sent) != 1 {
		t.Fatalf("sent %d mails, want 1", len(*sent))
	}
	mail := (*sent)[0]
	if mail.to != recipient.Email {
		t.Fatalf("mail to %s", mail.to)
	}
	if !strings.Contains(mail.subject, "2") {
		t.Errorf("subject should count important items only: %q", mail.subject)
	}
	if !strings.Contains(mail.html, "另有 3 个赞") {
		t.Error("attached likes should be summarised")
	}
	if !strings.Contains(mail.html, "另有 1 条线程回复") {
		t.Error("thread activity should be summarised")
	}

	// 重要行全部 sent，附带行也 sent（搭上车），不会再有下一封
	var states []model.Notification
	if err := repo.GetDB().Where("user_id = ?", recipient.ID).Order("id").Find(&states).Error; err != nil {
		t.Fatal(err)
	}
	for _, notification := range states {
		if notification.EmailState != constant.NotificationEmailStateSent {
			t.Errorf("notification %d state = %s, want sent", notification.ID, notification.EmailState)
		}
	}
	if err := sendNotificationEmails(now); err != nil {
		t.Fatalf("send again: %v", err)
	}
	if len(*sent) != 1 {
		t.Fatalf("second round sent %d mails, want 0", len(*sent)-1)
	}
}

// 附带行超过搭车窗口不搭车，超过 attach_max 的留在 attached 等下一封
func TestSendNotificationEmailsAttachWindow(t *testing.T) {
	setupNotificationEmailDB(t)
	if err := repo.KV.SetKV("notification_email_attach_max", 2); err != nil {
		t.Fatal(err)
	}
	if err := repo.KV.SetKV("notification_email_attach_hours", 1); err != nil {
		t.Fatal(err)
	}
	sent := stubEmailSender(t)
	recipient := createEmailUser(t, "owner", "zh")
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-10*time.Minute))
	// 窗口内的 3 条点赞：只能搭 2 条
	for i := 0; i < 3; i++ {
		addNotification(t, recipient, actor, constant.NotificationTypePostLiked, constant.NotificationEmailStateAttached, now.Add(-time.Duration(i+1)*time.Minute))
	}
	// 窗口外的 1 条点赞：不搭车
	old := now.Add(-3 * time.Hour)
	addNotification(t, recipient, actor, constant.NotificationTypePostLiked, constant.NotificationEmailStateAttached, old)

	if err := sendNotificationEmails(now); err != nil {
		t.Fatalf("send: %v", err)
	}
	if len(*sent) != 1 {
		t.Fatalf("sent %d mails", len(*sent))
	}
	// 剩下两条：1 条超出 attach_max 等下一封，1 条在搭车窗口外（由清理任务置 skipped）
	var attachedLeft int64
	repo.GetDB().Model(&model.Notification{}).
		Where("user_id = ? AND email_state = ?", recipient.ID, constant.NotificationEmailStateAttached).Count(&attachedLeft)
	if attachedLeft != 2 {
		t.Fatalf("attached left = %d, want 2", attachedLeft)
	}
	if skipped, err := repo.Notification.SkipStaleAttachedEmails(now.Add(-time.Hour)); err != nil || skipped != 1 {
		t.Fatalf("stale attached skipped = %d, err = %v", skipped, err)
	}
}

// 站点没开邮件、收件人已禁用或没有邮箱时直接跳过，不产生邮件
func TestSendNotificationEmailsSkipped(t *testing.T) {
	setupNotificationEmailDB(t)
	sent := stubEmailSender(t)
	disabled := createEmailUser(t, "disabled", "zh")
	repo.GetDB().Model(&model.User{}).Where("id = ?", disabled.ID).Update("disabled", true)
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	addNotification(t, disabled, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-time.Minute))

	if err := sendNotificationEmails(now); err != nil {
		t.Fatalf("send: %v", err)
	}
	if len(*sent) != 0 {
		t.Fatalf("disabled recipient got %d mails", len(*sent))
	}
	var state string
	repo.GetDB().Model(&model.Notification{}).Where("user_id = ?", disabled.ID).Pluck("email_state", &state)
	if state != constant.NotificationEmailStateSkipped {
		t.Fatalf("state = %s, want skipped", state)
	}
}

// 整批失败按 1m / 5m / 30m 退避，第三次失败后置 failed 不再重试；退避期间不会被再次扫到
func TestSendNotificationEmailsRetry(t *testing.T) {
	setupNotificationEmailDB(t)
	recipient := createEmailUser(t, "owner", "zh")
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	notification := addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-time.Minute))

	failures := 0
	original := sendNotificationEmail
	sendNotificationEmail = func(_ *utils.EmailConfig, _, _, _ string, _ map[string]string) error {
		failures++
		return errors.New("smtp down")
	}
	t.Cleanup(func() { sendNotificationEmail = original })

	// 第一次失败：退回 pending 并推迟一分钟
	if err := sendNotificationEmails(now); err != nil {
		t.Fatalf("send: %v", err)
	}
	var reloaded model.Notification
	repo.GetDB().Where("id = ?", notification.ID).First(&reloaded)
	if reloaded.EmailState != constant.NotificationEmailStatePending || reloaded.EmailAttempts != 1 {
		t.Fatalf("after first failure = %s / %d", reloaded.EmailState, reloaded.EmailAttempts)
	}
	if reloaded.EmailNextAt == nil || reloaded.EmailNextAt.Before(now.Add(50*time.Second)) {
		t.Fatalf("retry should be delayed, got %v", reloaded.EmailNextAt)
	}
	if reloaded.EmailLastErr == "" {
		t.Error("failure reason should be recorded")
	}
	// 退避未到期的这一轮不会再扫到
	if err := sendNotificationEmails(now.Add(10 * time.Second)); err != nil {
		t.Fatalf("send again: %v", err)
	}
	if failures != 1 {
		t.Fatalf("failures = %d, want 1", failures)
	}

	// 一直失败：第三次之后置为 failed，不再重试
	later := now.Add(5 * time.Minute)
	if err := sendNotificationEmails(later); err != nil {
		t.Fatal(err)
	}
	if err := sendNotificationEmails(later.Add(30 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	repo.GetDB().Where("id = ?", notification.ID).First(&reloaded)
	if reloaded.EmailState != constant.NotificationEmailStateFailed {
		t.Fatalf("state after max attempts = %s, want failed", reloaded.EmailState)
	}
	before := failures
	if err := sendNotificationEmails(later.Add(3 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	if failures != before {
		t.Fatalf("failed notification should not be retried, failures = %d", failures)
	}
}

// 超出单用户每小时上限时推迟而不丢弃
func TestSendNotificationEmailsRateLimit(t *testing.T) {
	setupNotificationEmailDB(t)
	sharedstate.UseMemory()
	if err := repo.KV.SetKV("notification_email_hourly_limit", 1); err != nil {
		t.Fatal(err)
	}
	sent := stubEmailSender(t)
	recipient := createEmailUser(t, "owner", "zh")
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	// 第一封正常发出，用掉这一小时的额度
	addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-2*time.Minute))
	if err := sendNotificationEmails(now); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 {
		t.Fatalf("first mail = %d", len(*sent))
	}
	second := addNotification(t, recipient, actor, constant.NotificationTypeCommentReplied, constant.NotificationEmailStatePending, now.Add(-time.Minute))
	if err := sendNotificationEmails(now); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 {
		t.Fatalf("rate limited mail should not be sent, total = %d", len(*sent))
	}
	var reloaded model.Notification
	repo.GetDB().Where("id = ?", second.ID).First(&reloaded)
	if reloaded.EmailState != constant.NotificationEmailStatePending || reloaded.EmailNextAt == nil || reloaded.EmailNextAt.Before(now.Add(50*time.Minute)) {
		t.Fatalf("rate limited notification = %s / %v", reloaded.EmailState, reloaded.EmailNextAt)
	}
}

// 保留期外的通知与事件被硬删，超搭车窗口的附带行置为 skipped
func TestNotificationCleanup(t *testing.T) {
	setupNotificationEmailDB(t)
	recipient := createEmailUser(t, "owner", "zh")
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	old := addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStateSent, now.AddDate(0, 0, -200))
	recent := addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStateSent, now.Add(-time.Hour))
	staleAttached := addNotification(t, recipient, actor, constant.NotificationTypePostLiked, constant.NotificationEmailStateAttached, now.Add(-48*time.Hour))

	if _, _, err := repo.Notification.DeleteBefore(now.AddDate(0, 0, -180)); err != nil {
		t.Fatalf("delete before: %v", err)
	}
	var count int64
	repo.GetDB().Unscoped().Model(&model.Notification{}).Where("id = ?", old.ID).Count(&count)
	if count != 0 {
		t.Error("expired notification should be hard deleted")
	}
	if _, _, err := repo.Notification.DeleteBefore(now.AddDate(0, 0, -180)); err != nil {
		t.Fatal(err)
	}
	repo.GetDB().Unscoped().Model(&model.Notification{}).Where("id = ?", recent.ID).Count(&count)
	if count != 1 {
		t.Error("recent notification should be kept")
	}
	// 事件一并清理（不算软删）
	repo.GetDB().Unscoped().Model(&model.InteractionEvent{}).Where("id = ?", old.EventID).Count(&count)
	if count != 0 {
		t.Error("expired event should be removed")
	}

	if skipped, err := repo.Notification.SkipStaleAttachedEmails(now.Add(-24 * time.Hour)); err != nil || skipped != 1 {
		t.Fatalf("skip stale = %d, err = %v", skipped, err)
	}
	var reloaded model.Notification
	repo.GetDB().Where("id = ?", staleAttached.ID).First(&reloaded)
	if reloaded.EmailState != constant.NotificationEmailStateSkipped {
		t.Fatalf("stale attached state = %s", reloaded.EmailState)
	}
}
