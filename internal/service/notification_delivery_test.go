package service

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 取消点赞后再点赞复用最早的事件；保留期清理不能删掉仍被通知引用的事件，
// 且事件被清理后取消点赞仍能删掉通知、再点赞仍能写入新通知（不撞 (dedupe_key, user_id) 唯一索引）
func TestRelikeAfterRetentionCleanup(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	authorID, _ := ctxutils.GetCurrentUserID(author)
	postID := createPublicPost(t, author, nil)
	likes := NewLikeService()
	countNotifications := func() int64 {
		var count int64
		repo.GetDB().Unscoped().Model(&model.Notification{}).Where("user_id = ?", authorID).Count(&count)
		return count
	}

	if _, svcerr := likes.ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil {
		t.Fatalf("like: %v", svcerr)
	}
	// 事件是很久以前第一次点赞时写的，通知行是最近一次点赞写的
	old := time.Now().AddDate(0, 0, -200)
	if err := repo.GetDB().Model(&model.InteractionEvent{}).Where("1 = 1").UpdateColumn("created_at", old).Error; err != nil {
		t.Fatal(err)
	}
	if _, events, err := repo.Notification.DeleteBefore(time.Now().AddDate(0, 0, -180)); err != nil || events != 0 {
		t.Fatalf("cleanup deleted %d referenced events, err = %v", events, err)
	}

	// 事件已被清理（模拟旧版本清理的结果）：取消点赞仍要删掉通知
	if err := repo.GetDB().Unscoped().Where("1 = 1").Delete(&model.InteractionEvent{}).Error; err != nil {
		t.Fatal(err)
	}
	if liked, svcerr := likes.ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil || liked {
		t.Fatalf("unlike: liked=%v err=%v", liked, svcerr)
	}
	if got := countNotifications(); got != 0 {
		t.Fatalf("notifications after unlike = %d, want 0", got)
	}
	// 再点赞：写入新事件与新通知
	if liked, svcerr := likes.ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil || !liked {
		t.Fatalf("like again: liked=%v err=%v", liked, svcerr)
	}
	if got := countNotifications(); got != 1 {
		t.Fatalf("notifications after re-like = %d, want 1", got)
	}
	// 没有通知引用的旧事件照常被清理
	if err := repo.GetDB().Model(&model.InteractionEvent{}).Where("1 = 1").UpdateColumn("created_at", old).Error; err != nil {
		t.Fatal(err)
	}
	if liked, svcerr := likes.ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil || liked {
		t.Fatalf("unlike again: %v", svcerr)
	}
	if _, events, err := repo.Notification.DeleteBefore(time.Now().AddDate(0, 0, -180)); err != nil || events != 1 {
		t.Fatalf("cleanup deleted %d unreferenced events, err = %v, want 1", events, err)
	}
}

// 后台重试只接受失败的行与超时仍停在 sending 的重要行；已发送、已跳过、等搭车、正在发送的都拒绝
func TestRetryNotificationDeliveryStates(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	authorID, _ := ctxutils.GetCurrentUserID(author)
	otherID, _ := ctxutils.GetCurrentUserID(other)
	svc := NewNotificationService()
	now := time.Now()
	var eventID uint
	makeRow := func(suffix, state string, claimedAt *time.Time) *model.Notification {
		t.Helper()
		next := now.Add(-time.Hour)
		eventID++
		row := &model.Notification{
			UserID: authorID, ActorID: otherID, Type: constant.NotificationTypeCommentCreated,
			DedupeKey: "retry:" + suffix, EventID: eventID,
			EmailState: state, EmailNextAt: &next, EmailClaimedAt: claimedAt, EmailAttempts: 3,
		}
		if err := repo.GetDB().Create(row).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}
	stale := now.Add(-2 * NotificationEmailSendingTimeout)
	fresh := now.Add(-time.Minute)
	cases := []struct {
		row   *model.Notification
		allow bool
	}{
		{makeRow("failed", constant.NotificationEmailStateFailed, nil), true},
		{makeRow("stale", constant.NotificationEmailStateSending, &stale), true},
		{makeRow("fresh", constant.NotificationEmailStateSending, &fresh), false},
		{makeRow("sent", constant.NotificationEmailStateSent, nil), false},
		{makeRow("skipped", constant.NotificationEmailStateSkipped, nil), false},
		{makeRow("attached", constant.NotificationEmailStateAttached, nil), false},
	}
	for _, c := range cases {
		svcerr := svc.RetryNotificationDelivery(admin, c.row.ID)
		var reloaded model.Notification
		repo.GetDB().First(&reloaded, c.row.ID)
		if c.allow {
			if svcerr != nil || reloaded.EmailState != constant.NotificationEmailStatePending || reloaded.EmailAttempts != 0 {
				t.Errorf("retry %s: err=%v state=%s attempts=%d", c.row.DedupeKey, svcerr, reloaded.EmailState, reloaded.EmailAttempts)
			}
			continue
		}
		expectSvcErr(t, svcerr, http.StatusConflict, "notification_delivery_not_retryable")
		if reloaded.EmailState != c.row.EmailState {
			t.Errorf("rejected retry changed %s state to %s", c.row.DedupeKey, reloaded.EmailState)
		}
	}
	expectSvcErr(t, svc.RetryNotificationDelivery(admin, 99999), http.StatusNotFound, "operation_target_not_found")
	expectSvcErr(t, svc.RetryNotificationDelivery(author, cases[0].row.ID), http.StatusForbidden, "permission_denied")
}

// SSE 连接名额：每个用户最多 NotificationStreamMaxPerUser 条，释放后可以再连；不同用户互不影响
func TestNotificationStreamSlots(t *testing.T) {
	sharedstate.UseMemory()
	svc := NewNotificationService()
	releases := make([]func(), 0, NotificationStreamMaxPerUser)
	for i := 0; i < NotificationStreamMaxPerUser; i++ {
		release, svcerr := svc.AcquireNotificationStream(41)
		if svcerr != nil {
			t.Fatalf("slot %d: %v", i, svcerr)
		}
		releases = append(releases, release)
	}
	_, svcerr := svc.AcquireNotificationStream(41)
	expectSvcErr(t, svcerr, http.StatusTooManyRequests, "too_many_requests")
	if release, svcerr := svc.AcquireNotificationStream(42); svcerr != nil {
		t.Fatalf("other user should not be limited: %v", svcerr)
	} else {
		release()
	}
	releases[2]()
	release, svcerr := svc.AcquireNotificationStream(41)
	if svcerr != nil {
		t.Fatalf("slot should be reusable after release: %v", svcerr)
	}
	release()
	for _, release := range releases {
		release()
	}
}

// 订阅重建（空消息）后唤醒本实例全部连接，各自重新推一次当前状态
func TestNotificationHubPublishAll(t *testing.T) {
	sharedstate.UseMemory()
	first, unsubscribeFirst := NotificationHub.Subscribe(51)
	second, unsubscribeSecond := NotificationHub.Subscribe(52)
	defer unsubscribeFirst()
	defer unsubscribeSecond()
	NotificationHub.publishAll()
	for _, ch := range []<-chan struct{}{first, second} {
		select {
		case <-ch:
		case <-time.After(time.Second):
			t.Fatal("every subscriber should be woken up")
		}
	}
}

// 未读接口带上最近一条通知的标记：点赞并入已有的未读组时组数不变，但标记会变新
func TestUnreadCountLatestMarker(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	svc := NewNotificationService()
	empty, svcerr := svc.GetUnreadCount(author)
	if svcerr != nil || empty.LatestID != 0 || empty.LatestAt != nil {
		t.Fatalf("empty marker = %+v, err = %v", empty, svcerr)
	}
	if _, svcerr := NewLikeService().ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil {
		t.Fatal(svcerr)
	}
	before, _ := svc.GetUnreadCount(author)
	if before.Total != 1 || before.LatestID == 0 || before.LatestAt == nil {
		t.Fatalf("marker after first like = %+v", before)
	}
	// 第二个人点赞：同一组，未读组数不变，最近一条变了
	third := createNotificationUser(t, "third", nil)
	thirdCtx := context.WithValue(context.Background(), "user_id", third.ID)
	time.Sleep(5 * time.Millisecond)
	if _, svcerr := NewLikeService().ToggleLike(thirdCtx, postID, constant.TargetTypePost, nil); svcerr != nil {
		t.Fatal(svcerr)
	}
	after, _ := svc.GetUnreadCount(author)
	if after.Total != before.Total {
		t.Fatalf("unread groups = %d, want unchanged %d", after.Total, before.Total)
	}
	if after.LatestID == before.LatestID || !after.LatestAt.After(*before.LatestAt) {
		t.Fatalf("latest marker should move forward: before=%+v after=%+v", before, after)
	}
}

// 测试通知不在库里写死某种语言的文案，由前端按 type 渲染
func TestSendTestNotificationStoresNoText(t *testing.T) {
	_, admin, _, _, _ := setupEditTest(t)
	adminID, _ := ctxutils.GetCurrentUserID(admin)
	if svcerr := NewNotificationService().SendTestNotification(admin); svcerr != nil {
		t.Fatal(svcerr)
	}
	var row model.Notification
	if err := repo.GetDB().Where("user_id = ? AND type = ?", adminID, notificationTypeSystemTest).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.SubjectTitle != "" || row.Excerpt != "" || row.EmailState != constant.NotificationEmailStateSkipped {
		t.Fatalf("test notification = %+v", row)
	}
}

// 邮件里的汇总间隔与纯附件评论的占位按收件人语言渲染
func TestNotificationEmailLocalizedTexts(t *testing.T) {
	en := notificationEmailTextsForLanguage("en")
	zh := notificationEmailTextsForLanguage("zh")
	if got := notificationIntervalText(en, 10*time.Minute); got != "10 minutes" {
		t.Errorf("en interval = %q", got)
	}
	if got := notificationIntervalText(en, time.Hour); got != "1 hour" {
		t.Errorf("en one hour = %q", got)
	}
	if got := notificationIntervalText(zh, 2*time.Hour); got != "2 小时" {
		t.Errorf("zh interval = %q", got)
	}
	marker := NotificationAttachmentMarker(notificationAttachmentImage, 3)
	if got := notificationExcerptText(en, marker, 60); got != "[3 images]" {
		t.Errorf("en images = %q", got)
	}
	if got := notificationExcerptText(zh, NotificationAttachmentMarker(notificationAttachmentFile, 1), 60); got != "[附件]" {
		t.Errorf("zh file = %q", got)
	}
	// 普通正文不受影响
	if got := notificationExcerptText(en, "hello [[neo:attachment:image:3]]", 60); !strings.HasPrefix(got, "hello") {
		t.Errorf("plain excerpt = %q", got)
	}
}

// 用户从未保存过偏好也能退订：邮件链接里的一键退订只改 users 表，发信前按当前偏好复核
func TestNotificationEmailPolicyFollowsCurrentPrefs(t *testing.T) {
	setupNotificationDB(t)
	if err := repo.KV.SetKV("notification_email_enable", true); err != nil {
		t.Fatal(err)
	}
	owner := createNotificationUser(t, "policy-owner", nil)
	row := &model.Notification{Type: constant.NotificationTypeCommentCreated}
	if reason := NewNotificationEmailPolicy(owner).ImportantSkipReason(row); reason != "" {
		t.Fatalf("default prefs should allow mail, got %q", reason)
	}
	read := time.Now()
	readRow := &model.Notification{Type: constant.NotificationTypeCommentCreated, ReadAt: &read}
	if reason := NewNotificationEmailPolicy(owner).ImportantSkipReason(readRow); reason != repo.NotificationEmailSkipRead {
		t.Fatalf("read row reason = %q", reason)
	}
	if _, svcerr := saveNotificationPreferences(owner, nil, []string{}, nil); svcerr != nil {
		t.Fatal(svcerr)
	}
	reloaded, _ := repo.User.GetUserByID(owner.ID)
	if reason := NewNotificationEmailPolicy(reloaded).ImportantSkipReason(row); reason != repo.NotificationEmailSkipUnsubscribed {
		t.Fatalf("after unsubscribe reason = %q", reason)
	}
}
