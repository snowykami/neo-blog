package repo

import (
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 折叠行有新回复时回到列表顶部（列表按最近活动排序，而不是首条的创建时间）；
// 已经发过邮件的折叠行重新挂回 attached，搭下一封邮件的车
func TestThreadAggregateMovesToTopAndReattaches(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		owner := notificationTestUser(t, "owner")
		actor := notificationTestUser(t, "actor")
		upsert := func() {
			t.Helper()
			event, err := Notification.CreateEvent(nil, &model.InteractionEvent{
				Type: constant.NotificationTypeCommentThreadReplied, ActorID: actor.ID, OwnerID: owner.ID,
				TargetType: constant.TargetTypeComment, TargetID: 5, DedupeKey: "thread:5:day:1",
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := Notification.UpsertThreadAggregate(nil, &model.Notification{
				EventID: event.ID, UserID: owner.ID, ActorID: actor.ID, Type: constant.NotificationTypeCommentThreadReplied,
				TargetType: constant.TargetTypeComment, TargetID: 5, CommentID: 5,
				DedupeKey: event.DedupeKey, AggregateActors: "actor", EmailState: constant.NotificationEmailStateAttached,
			}); err != nil {
				t.Fatal(err)
			}
		}
		upsert()
		folded := loadThreadAggregate(t, owner.ID, "thread:5:day:1")
		// 之后来了一条普通通知，折叠行排到第二
		later := makeNotification(t, owner.ID, actor.ID, constant.NotificationTypeCommentCreated, constant.TargetTypePost, 9, time.Now().Add(time.Second))
		first := func() uint {
			t.Helper()
			groups, _, err := Notification.List(&NotificationFilter{UserID: owner.ID, Size: 10})
			if err != nil || len(groups) != 2 {
				t.Fatalf("list = %d groups, err = %v", len(groups), err)
			}
			return groups[0].Notification.ID
		}
		if got := first(); got != later.ID {
			t.Fatalf("first row = %d, want the later notification %d", got, later.ID)
		}
		// 折叠行已经随一封邮件发出、也被读过
		if err := db.Model(&model.Notification{}).Where("id = ?", folded.ID).Updates(map[string]any{
			"email_state": constant.NotificationEmailStateSent, "read_at": time.Now(),
		}).Error; err != nil {
			t.Fatal(err)
		}
		time.Sleep(1100 * time.Millisecond)
		upsert()
		if got := first(); got != folded.ID {
			t.Fatalf("first row = %d, want the folded row %d after a new reply", got, folded.ID)
		}
		reloaded := loadThreadAggregate(t, owner.ID, "thread:5:day:1")
		if reloaded.EmailState != constant.NotificationEmailStateAttached || reloaded.ReadAt != nil || reloaded.AggregateCount != 2 {
			t.Fatalf("folded row = state %s read %v count %d", reloaded.EmailState, reloaded.ReadAt, reloaded.AggregateCount)
		}
		// 还在等搭车的折叠行保持原状态（不会被改成别的）
		upsert()
		if state := loadThreadAggregate(t, owner.ID, "thread:5:day:1").EmailState; state != constant.NotificationEmailStateAttached {
			t.Fatalf("attached folded row = %s", state)
		}
		// 标记已读不改变排序（updated_at 会变，activity_at 不变）
		if _, err := Notification.MarkRead(owner.ID, later.ID, ""); err != nil {
			t.Fatal(err)
		}
		if got := first(); got != folded.ID {
			t.Fatalf("mark read reordered the list: first = %d", got)
		}
	})
}

// 附带行领取：只领未读的、状态仍为 attached 的；领取后同一行不会被第二次领到
func TestClaimAttachedForEmail(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		owner := notificationTestUser(t, "owner")
		actor := notificationTestUser(t, "actor")
		now := time.Now()
		unread := makeNotification(t, owner.ID, actor.ID, constant.NotificationTypePostLiked, constant.TargetTypePost, 1, now.Add(-2*time.Minute))
		read := makeNotification(t, owner.ID, actor.ID, constant.NotificationTypePostLiked, constant.TargetTypePost, 2, now.Add(-time.Minute))
		db.Model(&model.Notification{}).Where("id IN ?", []uint{unread.ID, read.ID}).Update("email_state", constant.NotificationEmailStateAttached)
		db.Model(&model.Notification{}).Where("id = ?", read.ID).Update("read_at", now)

		claimed, err := Notification.ClaimAttachedForEmail(owner.ID, now.Add(-time.Hour), 10, now)
		if err != nil || len(claimed) != 1 || claimed[0].ID != unread.ID {
			t.Fatalf("claimed = %+v, err = %v", claimed, err)
		}
		again, err := Notification.ClaimAttachedForEmail(owner.ID, now.Add(-time.Hour), 10, now)
		if err != nil || len(again) != 0 {
			t.Fatalf("second claim = %d rows, err = %v", len(again), err)
		}
		// 没发出去：退回 attached，可以再被领取
		if err := Notification.ReleaseAttachedEmails([]uint{unread.ID}); err != nil {
			t.Fatal(err)
		}
		again, _ = Notification.ClaimAttachedForEmail(owner.ID, now.Add(-time.Hour), 10, now)
		if len(again) != 1 {
			t.Fatalf("released row should be claimable again, got %d", len(again))
		}
	})
}

// 邮件状态机的几条条件更新在两种方言上都能执行：保留期清理不删仍被引用的事件、收回超时批次、逾期跳过、重试只接受失败行
func TestNotificationEmailMaintenanceQueries(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		owner := notificationTestUser(t, "owner")
		actor := notificationTestUser(t, "actor")
		now := time.Now()
		old := now.AddDate(0, 0, -200)

		// 事件很旧、通知是最近的（取消后再点赞复用事件）：事件不能被删
		referenced := makeNotification(t, owner.ID, actor.ID, constant.NotificationTypePostLiked, constant.TargetTypePost, 1, now)
		db.Model(&model.InteractionEvent{}).Where("id = ?", referenced.EventID).UpdateColumn("created_at", old)
		orphan := &model.InteractionEvent{Type: constant.NotificationTypePostLiked, ActorID: actor.ID, OwnerID: owner.ID, DedupeKey: "orphan"}
		orphan.CreatedAt = old
		if err := db.Create(orphan).Error; err != nil {
			t.Fatal(err)
		}
		if _, events, err := Notification.DeleteBefore(now.AddDate(0, 0, -180)); err != nil || events != 1 {
			t.Fatalf("deleted events = %d, err = %v, want only the orphan", events, err)
		}
		var count int64
		db.Unscoped().Model(&model.InteractionEvent{}).Where("id = ?", referenced.EventID).Count(&count)
		if count != 1 {
			t.Fatal("referenced event was deleted")
		}

		pending := makeNotification(t, owner.ID, actor.ID, constant.NotificationTypeCommentCreated, constant.TargetTypePost, 2, now.Add(-2*time.Millisecond))
		overdue := makeNotification(t, owner.ID, actor.ID, constant.NotificationTypeCommentCreated, constant.TargetTypePost, 3, now.Add(-3*time.Millisecond))
		stale := makeNotification(t, owner.ID, actor.ID, constant.NotificationTypeCommentCreated, constant.TargetTypePost, 4, now.Add(-4*time.Millisecond))
		sent := makeNotification(t, owner.ID, actor.ID, constant.NotificationTypeCommentCreated, constant.TargetTypePost, 5, now.Add(-5*time.Millisecond))
		setRow := func(id uint, values map[string]any) {
			t.Helper()
			if err := db.Model(&model.Notification{}).Where("id = ?", id).Updates(values).Error; err != nil {
				t.Fatal(err)
			}
		}
		setRow(pending.ID, map[string]any{"email_state": constant.NotificationEmailStatePending, "email_next_at": now})
		setRow(overdue.ID, map[string]any{"email_state": constant.NotificationEmailStatePending, "email_next_at": now.Add(-48 * time.Hour)})
		setRow(stale.ID, map[string]any{"email_state": constant.NotificationEmailStateSending, "email_next_at": now.Add(-time.Hour), "email_claimed_at": now.Add(-time.Hour)})
		setRow(sent.ID, map[string]any{"email_state": constant.NotificationEmailStateSent})

		if skipped, err := Notification.SkipOverdueEmails(now.Add(-24 * time.Hour)); err != nil || skipped != 1 {
			t.Fatalf("overdue skipped = %d, err = %v", skipped, err)
		}
		if ok, err := Notification.RetryEmail(sent.ID, now.Add(-30*time.Minute), now); err != nil || ok {
			t.Fatalf("retry sent row = %v, err = %v", ok, err)
		}
		if reclaimed, err := Notification.ReclaimStaleSendingEmails(now.Add(-30*time.Minute), now, 3); err != nil || reclaimed != 1 {
			t.Fatalf("reclaimed = %d, err = %v", reclaimed, err)
		}
		var reloaded model.Notification
		db.First(&reloaded, stale.ID)
		if reloaded.EmailState != constant.NotificationEmailStatePending || reloaded.EmailAttempts != 1 || reloaded.EmailClaimedAt != nil {
			t.Fatalf("reclaimed row = %s / %d / %v", reloaded.EmailState, reloaded.EmailAttempts, reloaded.EmailClaimedAt)
		}
		claimed, err := Notification.ClaimEmailBatch([]uint{pending.ID, stale.ID, overdue.ID}, now)
		if err != nil || len(claimed) != 2 {
			t.Fatalf("claimed = %d, err = %v, want pending + reclaimed", len(claimed), err)
		}
		if id, at, err := Notification.LatestActivity(owner.ID); err != nil || id == 0 || at == nil {
			t.Fatalf("latest = %d / %v, err = %v", id, at, err)
		}
	})
}
