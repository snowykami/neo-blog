package tasks

import (
	"errors"
	"fmt"
	"maps"
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
	"github.com/snowykami/neo-blog/pkg/sharedstate"
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
	// notificationEmailRoundBudget 一轮最多跑多久：到点就停下，剩下的收件人留给下一轮。
	// 必须明显短于 service.NotificationEmailSendingTimeout，否则还在发的批次会被当成中断而收回
	notificationEmailRoundBudget = 5 * time.Minute
	// notificationEmailLeaseTTL 一轮的执行租约：持有期间自动续期，实例退出后最多这么久即可由别的实例接手
	notificationEmailLeaseTTL = time.Minute
)

// notificationEmailBackoff 整批失败的退避间隔（第 1、2 次失败后等待的时间）
var notificationEmailBackoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute}

// StartNotificationEmailWorker 启动通知邮件投递任务。一轮可能远长于扫描间隔（同步发 SMTP），
// 不能用固定有效期的 ClaimRound：改用自动续期的租约，同一时刻只有一个实例在发信
func StartNotificationEmailWorker() {
	go func() {
		for {
			runSafely("notification_email", runNotificationEmailRound)
			time.Sleep(notificationEmailInterval)
		}
	}()
}

// runNotificationEmailRound 拿到租约才执行一轮，执行完立即释放
func runNotificationEmailRound() {
	lease, err := sharedstate.AcquireLease("task_lease:notification_email", notificationEmailLeaseTTL)
	if err != nil {
		logrus.Warnf("notification email worker: acquire lease: %v", err)
		return
	}
	if lease == nil {
		return
	}
	defer lease.Release()
	if err := sendNotificationEmails(time.Now()); err != nil {
		logrus.Errorf("notification email worker: %v", err)
	}
}

// sendNotificationEmails 扫一遍到期的重要通知，按收件人合并成邮件后发送。
// 收回中断批次与丢弃逾期积压不受站点邮件开关影响，开关关闭期间也照常进行
func sendNotificationEmails(now time.Time) error {
	if reclaimed, err := repo.Notification.ReclaimStaleSendingEmails(now.Add(-service.NotificationEmailSendingTimeout), now, notificationEmailMaxAttempts); err != nil {
		logrus.Errorf("notification email: reclaim stale sending rows: %v", err)
	} else if reclaimed > 0 {
		logrus.Warnf("notification email: reclaimed %d rows stuck in sending", reclaimed)
	}
	if skipped, err := repo.Notification.SkipOverdueEmails(now.Add(-service.NotificationEmailOverdueAfter())); err != nil {
		logrus.Errorf("notification email: skip overdue rows: %v", err)
	} else if skipped > 0 {
		logrus.Infof("notification email: skipped %d overdue rows", skipped)
	}
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
	deadline := time.Now().Add(notificationEmailRoundBudget)
	for _, userID := range order {
		if time.Now().After(deadline) {
			// 剩下的收件人留给下一轮，避免一轮占着租约太久
			break
		}
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

// deliverNotificationEmail 一个收件人的一批到期通知 = 一封邮件。
// 先领取（pending → sending），再按收件人「当前」的偏好、已读状态复核，不该发的置 skipped 并记下原因
func deliverNotificationEmail(userID uint, due []model.Notification, now time.Time) error {
	ids := make([]uint, 0, len(due))
	for _, notification := range due {
		ids = append(ids, notification.ID)
	}
	claimed, err := repo.Notification.ClaimEmailBatch(ids, now)
	if err != nil {
		return err
	}
	claimed = dropAlreadySent(claimed, now)
	if len(claimed) == 0 {
		// 被别的实例领走，或领取前已被标记已读
		return nil
	}

	recipient, err := repo.User.GetUserByID(userID)
	if err != nil {
		// 用户已注销：没有收件人了
		recipient = nil
	}
	policy := service.NewNotificationEmailPolicy(recipient)
	eligible := make([]model.Notification, 0, len(claimed))
	skippedByReason := map[string][]uint{}
	for i := range claimed {
		if reason := policy.ImportantSkipReason(&claimed[i]); reason != "" {
			skippedByReason[reason] = append(skippedByReason[reason], claimed[i].ID)
			continue
		}
		eligible = append(eligible, claimed[i])
	}
	for reason, skippedIDs := range skippedByReason {
		if err := repo.Notification.MarkEmailsSkipped(skippedIDs, reason); err != nil {
			return err
		}
	}
	if len(eligible) == 0 {
		return nil
	}
	eligibleIDs := notificationIDs(eligible)

	// 单用户每小时上限：超了就把这一批推迟一小时，既不影响送达也不给别人的邮箱刷屏
	if !utils.AllowRequest("notify_email:"+itoaUint(userID), config.Int("notification_email_hourly_limit"), time.Hour) {
		return repo.Notification.DeferEmails(eligibleIDs, now.Add(time.Hour))
	}

	// 附带行：搭车窗口内、仍未读、最多 attach_max 条；同样先领取再复核，窗口外的由清理任务置 skipped
	attachHours := config.Int("notification_email_attach_hours")
	attachMax := config.Int("notification_email_attach_max")
	since := now.Add(-time.Duration(attachHours) * time.Hour)
	attachedClaimed, err := repo.Notification.ClaimAttachedForEmail(userID, since, attachMax, now)
	if err != nil {
		// 附带行领取失败不影响主列表：退回主列表，下一轮再来
		return errors.Join(err, repo.Notification.DeferEmails(eligibleIDs, now))
	}
	attachedClaimed = dropAlreadySent(attachedClaimed, now)
	attached := make([]model.Notification, 0, len(attachedClaimed))
	attachedSkipped := map[string][]uint{}
	for i := range attachedClaimed {
		if reason := policy.AttachedSkipReason(&attachedClaimed[i]); reason != "" {
			attachedSkipped[reason] = append(attachedSkipped[reason], attachedClaimed[i].ID)
			continue
		}
		attached = append(attached, attachedClaimed[i])
	}
	for reason, skippedIDs := range attachedSkipped {
		if err := repo.Notification.MarkEmailsSkipped(skippedIDs, reason); err != nil {
			return err
		}
	}
	attachedIDs := notificationIDs(attached)
	likes, threads, hasAI := 0, 0, false
	for i := range attached {
		switch attached[i].Type {
		case constant.NotificationTypeCommentThreadReplied:
			threads += max(attached[i].AggregateCount, 1)
		case constant.NotificationTypePostLiked, constant.NotificationTypeCommentLiked:
			likes++
		default:
			// 其余都是 AI 的评论 / 回复
			hasAI = true
		}
	}

	// 主列表：超出单封上限的只计数，不拆成第二封
	maxItems := max(config.Int("notification_email_max_items"), 1)
	limit := min(len(eligible), maxItems)
	content, err := service.RenderNotificationEmail(&service.NotificationEmailInput{
		Recipient:    recipient,
		Important:    eligible[:limit],
		ImportantAll: len(eligible),
		Interval:     time.Duration(config.Int("notification_email_interval")) * time.Minute,
		Attached:     service.NotificationAttachedSummary(recipient.Language, likes, threads, hasAI),
		SettingsURL:  service.NotificationSettingsURL(recipient, now),
		Now:          now,
	})
	if err != nil {
		return errors.Join(rescheduleNotificationEmails(eligible, "render", err, now), repo.Notification.ReleaseAttachedEmails(attachedIDs))
	}
	// 批次标识写进邮件头，排查重复投递时能对上代码里的这一轮
	batchID := fmt.Sprintf("notif-%d-%d", now.Unix(), userID)
	headers := map[string]string{"X-NeoBlog-Notification-Batch": batchID}
	// 邮箱客户端的「退订」按钮（一键退订）
	maps.Copy(headers, service.NotificationUnsubscribeHeaders(recipient, now))
	if err := sendNotificationEmail(tools.GetEmailConfig(), recipient.Email, content.Subject, content.HTML, headers); err != nil {
		// 附带行没搭上车：退回 attached 等下一封
		return errors.Join(rescheduleNotificationEmails(eligible, batchID, err, now), repo.Notification.ReleaseAttachedEmails(attachedIDs))
	}
	// 主列表与搭上车的附带行一起置为已发送；超出 attach_max 的继续挂着等下一封
	return markNotificationEmailsSent(append(eligibleIDs, attachedIDs...), now)
}

// notificationEmailSentMemoTTL 「已发出但没能写库」的记录保留多久：须长于 sending 超时收回的时间，收回后再被领取时能认出来
const notificationEmailSentMemoTTL = 24 * time.Hour

// notificationEmailSentRetries 邮件发出后写库失败时的重试间隔
var notificationEmailSentRetries = []time.Duration{500 * time.Millisecond, 2 * time.Second}

func notificationEmailSentKey(id uint) string {
	return "notification_email:sent:" + itoaUint(id)
}

// markNotificationEmailsSent 邮件已经发出，把这些行置为 sent。写库失败时短暂重试；仍失败就在共享状态里记下「已发出」，
// 这些行超时被收回、再次领取时直接置为 sent（见 dropAlreadySent），收件人不会收到重复的邮件
func markNotificationEmailsSent(ids []uint, now time.Time) error {
	err := repo.Notification.MarkEmailsSent(ids, now)
	for _, wait := range notificationEmailSentRetries {
		if err == nil {
			return nil
		}
		time.Sleep(wait)
		err = repo.Notification.MarkEmailsSent(ids, now)
	}
	if err == nil {
		return nil
	}
	for _, id := range ids {
		if memoErr := sharedstate.Current().Set(notificationEmailSentKey(id), "1", notificationEmailSentMemoTTL); memoErr != nil {
			logrus.Errorf("notification email: remember sent row %d: %v", id, memoErr)
		}
	}
	return err
}

// dropAlreadySent 去掉上次已经发出、只是没能写库的行，并把它们补记为 sent；共享状态读取失败时按未发出处理
func dropAlreadySent(claimed []model.Notification, now time.Time) []model.Notification {
	if len(claimed) == 0 {
		return claimed
	}
	keys := make([]string, 0, len(claimed))
	for i := range claimed {
		keys = append(keys, notificationEmailSentKey(claimed[i].ID))
	}
	memo, err := sharedstate.Current().GetMany(keys...)
	if err != nil || len(memo) == 0 {
		return claimed
	}
	rest := make([]model.Notification, 0, len(claimed))
	var sent []uint
	for i := range claimed {
		if _, ok := memo[notificationEmailSentKey(claimed[i].ID)]; ok {
			sent = append(sent, claimed[i].ID)
			continue
		}
		rest = append(rest, claimed[i])
	}
	if err := repo.Notification.MarkEmailsSent(sent, now); err != nil {
		logrus.Errorf("notification email: mark previously sent rows: %v", err)
	} else {
		_ = sharedstate.Current().Delete(keys...)
	}
	return rest
}

// notificationIDs 取出一组通知的 id
func notificationIDs(notifications []model.Notification) []uint {
	ids := make([]uint, 0, len(notifications))
	for i := range notifications {
		ids = append(ids, notifications[i].ID)
	}
	return ids
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
