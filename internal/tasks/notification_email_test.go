package tasks

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
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
	sendNotificationEmail = func(_ *utils.EmailConfig, to, subject, html string) error {
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
	event, err := repo.Notification.CreateEvent(nil, &model.InteractionEvent{
		Type: eventType, ActorID: actor.ID, OwnerID: owner.ID, DedupeKey: dedupeKey,
	})
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
