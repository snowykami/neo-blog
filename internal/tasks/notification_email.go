package tasks

import (
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 通知汇总邮件的投递 worker：只有「重要」消息（真人评论 / 回复）会触发发信，
// 点赞、AI 互动与线程活动只搭同一批的车（见 docs/notification-spec.md 6.2 / 6.3）
const (
	notificationEmailInterval = 30 * time.Second
	// notificationEmailScanLimit 一次最多处理多少条到期通知，避免一轮占用太久
	notificationEmailScanLimit = 500
	// notificationEmailMaxAttempts 整批失败的重试次数上限，用完置为 failed 不再重试
	notificationEmailMaxAttempts = 3
)

// notificationEmailBackoff 整批失败的退避间隔（第 1、2 次失败后等待的时间）
var notificationEmailBackoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute}

// StartNotificationEmailWorker 启动通知邮件投递任务；多实例部署时每轮只有一个实例执行
func StartNotificationEmailWorker() {
	runPeriodically("notification_email", notificationEmailInterval, func() {
		if err := sendNotificationEmails(time.Now()); err != nil {
			logrus.Errorf("notification email worker: %v", err)
		}
	})
}

// sendNotificationEmails 扫一遍到期的重要通知，按收件人合并成邮件后发送
func sendNotificationEmails(now time.Time) error {
	if !config.Bool("notification_email_enable") {
		return nil
	}
	due, err := repo.Notification.ListDueEmailPending(now, notificationEmailScanLimit)
	if err != nil {
		return err
	}
	if len(due) == 0 {
		return nil
	}
	byUser := map[uint][]model.Notification{}
	order := make([]uint, 0, 4)
	for _, notification := range due {
		if _, ok := byUser[notification.UserID]; !ok {
			order = append(order, notification.UserID)
		}
		byUser[notification.UserID] = append(byUser[notification.UserID], notification)
	}
	sort.Slice(order, func(i, j int) bool { return order[i] < order[j] })
	for _, userID := range order {
		if err := deliverNotificationEmail(userID, byUser[userID], now); err != nil {
			logrus.Errorf("notification email to user %d: %v", userID, err)
		}
	}
	return nil
}

// sendNotificationEmail 实际发信（带批量标识头），测试里替换成假的发送器
var sendNotificationEmail = func(cfg *utils.EmailConfig, to, subject, html string, headers map[string]string) error {
	return utils.Email.SendEmailWithHeaders(cfg, to, subject, html, true, headers)
}

// deliverNotificationEmail 一个收件人的一批到期通知 = 一封邮件
func deliverNotificationEmail(userID uint, due []model.Notification, now time.Time) error {
	ids := make([]uint, 0, len(due))
	for _, notification := range due {
		ids = append(ids, notification.ID)
	}
	recipient, err := repo.User.GetUserByID(userID)
	if err != nil {
		// 用户已注销：没有收件人了，直接跳过
		return repo.Notification.MarkEmailsSkipped(ids)
	}
	if recipient.Disabled || recipient.Email == "" {
		return repo.Notification.MarkEmailsSkipped(ids)
	}
	// 单用户每小时上限：超了就把这一批推迟一小时，既不影响送达也不给别人的邮箱刷屏
	if !utils.AllowRequest("notify_email:"+itoaUint(userID), config.Int("notification_email_hourly_limit"), time.Hour) {
		return repo.Notification.DeferEmails(ids, now.Add(time.Hour))
	}

	claimed, err := repo.Notification.ClaimEmailBatch(ids)
	if err != nil {
		return err
	}
	if len(claimed) == 0 {
		// 被别的实例领走了
		return nil
	}
	claimedIDs := make([]uint, 0, len(claimed))
	for _, notification := range claimed {
		claimedIDs = append(claimedIDs, notification.ID)
	}

	// 附带行：搭车窗口内、最多 attach_max 条；窗口外的由清理任务置 skipped
	attachHours := config.Int("notification_email_attach_hours")
	attachMax := config.Int("notification_email_attach_max")
	since := now.Add(-time.Duration(attachHours) * time.Hour)
	attached, err := repo.Notification.ListAttachedForEmail(userID, since, attachMax)
	if err != nil {
		return err
	}
	attachedIDs := make([]uint, 0, len(attached))
	likes, threads, hasAI := 0, 0, false
	for i := range attached {
		attachedIDs = append(attachedIDs, attached[i].ID)
		switch attached[i].Type {
		case constant.NotificationTypeCommentThreadReplied:
			threads += attached[i].AggregateCount
			if threads == 0 {
				threads = 1
			}
		case constant.NotificationTypePostLiked, constant.NotificationTypeCommentLiked:
			likes++
		default:
			// 其余都是 AI 的评论 / 回复
			hasAI = true
		}
	}

	// 主列表：超出单封上限的只计数，不拆成第二封
	maxItems := max(config.Int("notification_email_max_items"), 1)
	limit := min(len(claimed), maxItems)
	content, err := service.RenderNotificationEmail(&service.NotificationEmailInput{
		Recipient:    recipient,
		Important:    claimed[:limit],
		ImportantAll: len(claimed),
		Interval:     time.Duration(config.Int("notification_email_interval")) * time.Minute,
		Attached:     service.NotificationAttachedSummary(recipient.Language, likes, threads, hasAI),
		SettingsURL:  service.NotificationSettingsURL(recipient, now),
		Now:          now,
	})
	if err != nil {
		return rescheduleNotificationEmails(claimed, "render", err, now)
	}
	// 批次标识写进邮件头，排查重复投递时能对上代码里的这一轮
	batchID := fmt.Sprintf("notif-%d-%d", now.Unix(), userID)
	if err := sendNotificationEmail(tools.GetEmailConfig(), recipient.Email, content.Subject, content.HTML, map[string]string{
		"X-NeoBlog-Notification-Batch": batchID,
	}); err != nil {
		return rescheduleNotificationEmails(claimed, batchID, err, now)
	}
	if err := repo.Notification.MarkEmailsSent(claimedIDs, now); err != nil {
		return err
	}
	// 搭上车的附带行一起置为已发送；超出 attach_max 的继续挂着等下一封
	return repo.Notification.MarkEmailsSent(attachedIDs, now)
}

// rescheduleNotificationEmails 整批失败：按 1m / 5m / 30m 退避，重试用尽后置为 failed 并记录原因
func rescheduleNotificationEmails(claimed []model.Notification, batchID string, cause error, now time.Time) error {
	ids := make([]uint, 0, len(claimed))
	attempts := 1
	for i := range claimed {
		ids = append(ids, claimed[i].ID)
		if next := claimed[i].EmailAttempts + 1; next > attempts {
			attempts = next
		}
	}
	if attempts >= notificationEmailMaxAttempts {
		logrus.Warnf("notification email batch %s failed %d times, giving up: %v", batchID, attempts, cause)
		return repo.Notification.RescheduleEmails(ids, now, cause.Error(), true)
	}
	delay := notificationEmailBackoff[min(attempts, len(notificationEmailBackoff))-1]
	logrus.Infof("notification email batch %s failed (attempt %d), retry in %s: %v", batchID, attempts, delay, cause)
	return repo.Notification.RescheduleEmails(ids, now.Add(delay), cause.Error(), false)
}

// itoaUint 限速键里的用户 id
func itoaUint(value uint) string {
	return strconv.FormatUint(uint64(value), 10)
}
