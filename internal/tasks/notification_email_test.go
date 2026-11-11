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
	// 昵称与头像要出现在邮件正文里（Actor 关联必须预加载）
	actor.Nickname = "小明同学"
	actor.AvatarUrl = "https://cdn.example.com/actor.png"
	if err := repo.GetDB().Model(actor).Updates(map[string]any{
		"nickname": actor.Nickname, "avatar_url": actor.AvatarUrl,
	}).Error; err != nil {
		t.Fatal(err)
	}
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
	if !strings.Contains(mail.html, actor.Nickname) || !strings.Contains(mail.html, actor.AvatarUrl) {
		t.Errorf("邮件里缺少作者昵称或头像：nickname=%v avatar=%v",
			strings.Contains(mail.html, actor.Nickname), strings.Contains(mail.html, actor.AvatarUrl))
	}
	if strings.Contains(mail.html, "— 评论了") {
		t.Error("作者昵称不应退化成破折号")
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
	// 昵称与头像要出现在邮件正文里（Actor 关联必须预加载）
	actor.Nickname = "小明同学"
	actor.AvatarUrl = "https://cdn.example.com/actor.png"
	if err := repo.GetDB().Model(actor).Updates(map[string]any{
		"nickname": actor.Nickname, "avatar_url": actor.AvatarUrl,
	}).Error; err != nil {
		t.Fatal(err)
	}
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
	// 昵称与头像要出现在邮件正文里（Actor 关联必须预加载）
	actor.Nickname = "小明同学"
	actor.AvatarUrl = "https://cdn.example.com/actor.png"
	if err := repo.GetDB().Model(actor).Updates(map[string]any{
		"nickname": actor.Nickname, "avatar_url": actor.AvatarUrl,
	}).Error; err != nil {
		t.Fatal(err)
	}
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
	// 昵称与头像要出现在邮件正文里（Actor 关联必须预加载）
	actor.Nickname = "小明同学"
	actor.AvatarUrl = "https://cdn.example.com/actor.png"
	if err := repo.GetDB().Model(actor).Updates(map[string]any{
		"nickname": actor.Nickname, "avatar_url": actor.AvatarUrl,
	}).Error; err != nil {
		t.Fatal(err)
	}
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
	// 昵称与头像要出现在邮件正文里（Actor 关联必须预加载）
	actor.Nickname = "小明同学"
	actor.AvatarUrl = "https://cdn.example.com/actor.png"
	if err := repo.GetDB().Model(actor).Updates(map[string]any{
		"nickname": actor.Nickname, "avatar_url": actor.AvatarUrl,
	}).Error; err != nil {
		t.Fatal(err)
	}
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
	// 昵称与头像要出现在邮件正文里（Actor 关联必须预加载）
	actor.Nickname = "小明同学"
	actor.AvatarUrl = "https://cdn.example.com/actor.png"
	if err := repo.GetDB().Model(actor).Updates(map[string]any{
		"nickname": actor.Nickname, "avatar_url": actor.AvatarUrl,
	}).Error; err != nil {
		t.Fatal(err)
	}
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

// 写入后才退订（邮件里的一键退订只改 users 表）：发信前按当前偏好复核，已排队的不再发出
func TestSendNotificationEmailsUnsubscribedAfterPending(t *testing.T) {
	setupNotificationEmailDB(t)
	sent := stubEmailSender(t)
	recipient := createEmailUser(t, "owner", "zh")
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	row := addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-time.Minute))
	if err := repo.GetDB().Model(&model.User{}).Where("id = ?", recipient.ID).
		Update("notification_prefs", `{"inapp":["comment.created"],"email":[],"ai_interactions":true}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := sendNotificationEmails(now); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 0 {
		t.Fatalf("unsubscribed recipient got %d mails", len(*sent))
	}
	var reloaded model.Notification
	repo.GetDB().First(&reloaded, row.ID)
	if reloaded.EmailState != constant.NotificationEmailStateSkipped || reloaded.EmailLastErr != repo.NotificationEmailSkipUnsubscribed {
		t.Fatalf("state = %s / %q, want skipped / unsubscribed", reloaded.EmailState, reloaded.EmailLastErr)
	}
}

// 站点邮件关闭期间积压的旧通知逾期后置 skipped；重新打开后只发近期的，不会一次性灌进收件箱
func TestSendNotificationEmailsSiteSwitchBacklog(t *testing.T) {
	setupNotificationEmailDB(t)
	sent := stubEmailSender(t)
	recipient := createEmailUser(t, "owner", "zh")
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	stale := addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-3*24*time.Hour))
	recent := addNotification(t, recipient, actor, constant.NotificationTypeCommentReplied, constant.NotificationEmailStatePending, now.Add(-10*time.Minute))
	if err := repo.KV.SetKV("notification_email_enable", false); err != nil {
		t.Fatal(err)
	}
	if err := sendNotificationEmails(now); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 0 {
		t.Fatalf("site switch off but sent %d mails", len(*sent))
	}
	stateOf := func(id uint) model.Notification {
		var row model.Notification
		repo.GetDB().First(&row, id)
		return row
	}
	if row := stateOf(stale.ID); row.EmailState != constant.NotificationEmailStateSkipped || row.EmailLastErr != repo.NotificationEmailSkipOverdue {
		t.Fatalf("overdue row = %s / %q", row.EmailState, row.EmailLastErr)
	}
	if row := stateOf(recent.ID); row.EmailState != constant.NotificationEmailStatePending {
		t.Fatalf("recent row = %s, want pending while switch is off", row.EmailState)
	}
	if err := repo.KV.SetKV("notification_email_enable", true); err != nil {
		t.Fatal(err)
	}
	if err := sendNotificationEmails(now); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || !strings.Contains((*sent)[0].subject, "回复了你的评论") {
		t.Fatalf("after switching on: %d mails %+v", len(*sent), *sent)
	}
	if row := stateOf(recent.ID); row.EmailState != constant.NotificationEmailStateSent {
		t.Fatalf("recent row = %s, want sent", row.EmailState)
	}
}

// 已读的附带行不再搭车：「另有 N 个赞」只数仍未读的
func TestSendNotificationEmailsExcludesReadAttachments(t *testing.T) {
	setupNotificationEmailDB(t)
	sent := stubEmailSender(t)
	recipient := createEmailUser(t, "owner", "zh")
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-5*time.Minute))
	addNotification(t, recipient, actor, constant.NotificationTypePostLiked, constant.NotificationEmailStateAttached, now.Add(-2*time.Minute))
	// 与标记已读并发的情形：已读但状态还停在 attached
	read := addNotification(t, recipient, actor, constant.NotificationTypePostLiked, constant.NotificationEmailStateAttached, now.Add(-3*time.Minute))
	repo.GetDB().Model(&model.Notification{}).Where("id = ?", read.ID).UpdateColumn("read_at", now)
	if err := sendNotificationEmails(now); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 {
		t.Fatalf("sent %d mails", len(*sent))
	}
	if !strings.Contains((*sent)[0].html, "另有 1 个赞") {
		t.Error("read like should not be counted")
	}
	var reloaded model.Notification
	repo.GetDB().First(&reloaded, read.ID)
	if reloaded.EmailState != constant.NotificationEmailStateAttached {
		t.Fatalf("read attached row = %s, should not ride along", reloaded.EmailState)
	}
}

// 发信实例中途退出：超时仍停在 sending 的行被收回，重要行算一次失败后重发，附带行退回 attached 再搭车；
// 未超时的 sending 行不动（可能还在别的实例上发）
func TestSendNotificationEmailsReclaimStaleSending(t *testing.T) {
	setupNotificationEmailDB(t)
	sent := stubEmailSender(t)
	recipient := createEmailUser(t, "owner", "zh")
	other := createEmailUser(t, "other", "zh")
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	staleAt := now.Add(-time.Hour)
	freshAt := now.Add(-time.Minute)

	important := addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-2*time.Hour))
	like := addNotification(t, recipient, actor, constant.NotificationTypePostLiked, constant.NotificationEmailStateAttached, now.Add(-90*time.Minute))
	fresh := addNotification(t, other, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-time.Hour))
	for id, at := range map[uint]time.Time{important.ID: staleAt, like.ID: staleAt, fresh.ID: freshAt} {
		if err := repo.GetDB().Model(&model.Notification{}).Where("id = ?", id).Updates(map[string]any{
			"email_state": constant.NotificationEmailStateSending, "email_claimed_at": at,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := sendNotificationEmails(now); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || (*sent)[0].to != recipient.Email {
		t.Fatalf("sent = %+v, want one mail to the reclaimed recipient", *sent)
	}
	if !strings.Contains((*sent)[0].html, "另有 1 个赞") {
		t.Error("reclaimed attached row should ride along again")
	}
	var rows []model.Notification
	repo.GetDB().Order("id").Find(&rows)
	for _, row := range rows {
		switch row.ID {
		case important.ID:
			if row.EmailState != constant.NotificationEmailStateSent || row.EmailAttempts != 1 {
				t.Errorf("important = %s / attempts %d", row.EmailState, row.EmailAttempts)
			}
		case like.ID:
			if row.EmailState != constant.NotificationEmailStateSent {
				t.Errorf("like = %s", row.EmailState)
			}
		case fresh.ID:
			if row.EmailState != constant.NotificationEmailStateSending {
				t.Errorf("fresh sending row = %s, should be left alone", row.EmailState)
			}
		}
	}

	// 反复中断：重试次数用尽后置 failed，不会无限重发
	repo.GetDB().Model(&model.Notification{}).Where("id = ?", fresh.ID).Updates(map[string]any{
		"email_claimed_at": staleAt, "email_attempts": notificationEmailMaxAttempts - 1,
	})
	if _, err := repo.Notification.ReclaimStaleSendingEmails(now.Add(-30*time.Minute), now, notificationEmailMaxAttempts); err != nil {
		t.Fatal(err)
	}
	var reloaded model.Notification
	repo.GetDB().First(&reloaded, fresh.ID)
	if reloaded.EmailState != constant.NotificationEmailStateFailed {
		t.Fatalf("exhausted reclaimed row = %s, want failed", reloaded.EmailState)
	}
}

// 英文收件人的汇总间隔用英文写，不再混进「分钟」
func TestSendNotificationEmailsEnglishInterval(t *testing.T) {
	setupNotificationEmailDB(t)
	sent := stubEmailSender(t)
	recipient := createEmailUser(t, "owner", "en")
	actor := createEmailUser(t, "actor", "en")
	now := time.Now()
	addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-time.Minute))
	if err := sendNotificationEmails(now); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 {
		t.Fatalf("sent %d", len(*sent))
	}
	if strings.Contains((*sent)[0].html, "分钟") || !strings.Contains((*sent)[0].html, "10 minutes") {
		t.Error("interval should be rendered in the recipient's language")
	}
}

// 邮件发出后写库失败：共享状态里记下「已发出」，这些行超时被收回、再次领取时直接置为 sent，不会重发
func TestNotificationEmailNotResentAfterMarkFailure(t *testing.T) {
	setupNotificationEmailDB(t)
	sharedstate.UseMemory()
	sent := stubEmailSender(t)
	recipient := createEmailUser(t, "owner", "zh")
	actor := createEmailUser(t, "actor", "zh")
	now := time.Now()
	row := addNotification(t, recipient, actor, constant.NotificationTypeCommentCreated, constant.NotificationEmailStatePending, now.Add(-10*time.Minute))
	// 模拟上一轮：已经发出，但置为 sent 时写库失败（记录留在共享状态里）
	if err := sharedstate.Current().Set(notificationEmailSentKey(row.ID), "1", notificationEmailSentMemoTTL); err != nil {
		t.Fatal(err)
	}

	if err := sendNotificationEmails(now); err != nil {
		t.Fatalf("send: %v", err)
	}
	if len(*sent) != 0 {
		t.Fatalf("sent %d mails, want none (already sent before)", len(*sent))
	}
	var got model.Notification
	if err := repo.GetDB().First(&got, row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.EmailState != constant.NotificationEmailStateSent {
		t.Fatalf("email state = %s, want sent", got.EmailState)
	}
	if _, ok, _ := sharedstate.Current().Get(notificationEmailSentKey(row.ID)); ok {
		t.Fatal("memo should be cleared once the row is marked sent")
	}
}
