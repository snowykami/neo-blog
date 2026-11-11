package repo

import (
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func notificationTestUser(t *testing.T, name string) *model.User {
	t.Helper()
	user := &model.User{Username: name, Email: name + "@example.com"}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("create user %s: %v", name, err)
	}
	return user
}

// makeNotification 造一条通知行并指定创建时间，用于验证按自然日归并
func makeNotification(t *testing.T, ownerID, actorID uint, eventType, targetType string, targetID uint, at time.Time) *model.Notification {
	t.Helper()
	dedupeKey := eventType + ":" + at.Format(time.RFC3339Nano)
	event := &model.InteractionEvent{Type: eventType, ActorID: actorID, OwnerID: ownerID, DedupeKey: dedupeKey}
	event.CreatedAt = at
	if err := db.Create(event).Error; err != nil {
		t.Fatalf("create event: %v", err)
	}
	notification := &model.Notification{
		EventID:      event.ID,
		UserID:       ownerID,
		ActorID:      actorID,
		Type:         eventType,
		SubjectType:  constant.TargetTypePost,
		SubjectID:    targetID,
		SubjectTitle: "文章标题",
		TargetType:   targetType,
		TargetID:     targetID,
		DedupeKey:    dedupeKey,
	}
	notification.CreatedAt = at
	if err := db.Create(notification).Error; err != nil {
		t.Fatalf("create notification: %v", err)
	}
	return notification
}

// 点赞按「类型 + 目标 + 自然日」归并成一行，其它类型各占一行；两天的赞不应合并
func TestNotificationListGroupsLikesByDay(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		owner := notificationTestUser(t, "owner")
		day := time.Date(2026, 11, 8, 3, 0, 0, 0, time.UTC)
		// 同一天 3 个赞 → 1 行；第二天 1 个赞 → 另 1 行
		for i, name := range []string{"a1", "a2", "a3"} {
			actor := notificationTestUser(t, name)
			makeNotification(t, owner.ID, actor.ID, constant.NotificationTypePostLiked, constant.TargetTypePost, 12, day.Add(time.Duration(i)*time.Hour))
		}
		late := notificationTestUser(t, "a4")
		makeNotification(t, owner.ID, late.ID, constant.NotificationTypePostLiked, constant.TargetTypePost, 12, day.AddDate(0, 0, 1))
		// 同一天里的一条评论与一条回复各自成行
		commenter := notificationTestUser(t, "c1")
		makeNotification(t, owner.ID, commenter.ID, constant.NotificationTypeCommentCreated, constant.TargetTypePost, 12, day.Add(2*time.Hour))
		replier := notificationTestUser(t, "c2")
		makeNotification(t, owner.ID, replier.ID, constant.NotificationTypeCommentReplied, constant.TargetTypeComment, 99, day.Add(3*time.Hour))

		groups, total, err := Notification.List(&NotificationFilter{UserID: owner.ID, Size: 10, TimeZone: "UTC"})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if total != 4 {
			t.Fatalf("total groups = %d, want 4", total)
		}
		if len(groups) != 4 {
			t.Fatalf("groups = %d, want 4", len(groups))
		}
		// 按组内最新一条排序：第二天的赞最新，之后是同日的回复、评论、三个赞的组
		wantOrder := []string{
			constant.NotificationTypePostLiked,
			constant.NotificationTypeCommentReplied,
			constant.NotificationTypeCommentCreated,
			constant.NotificationTypePostLiked,
		}
		for i, want := range wantOrder {
			if groups[i].Notification.Type != want {
				t.Fatalf("group %d type = %s, want %s", i, groups[i].Notification.Type, want)
			}
		}
		likeGroups := map[int64]bool{}
		for _, group := range groups {
			if group.Notification.Type != constant.NotificationTypePostLiked {
				continue
			}
			likeGroups[group.Count] = true
			if group.Count == 3 && len(group.ActorNames) != 2 {
				t.Fatalf("like group should carry 2 actor names, got %v", group.ActorNames)
			}
			if group.Count == 1 && len(group.ActorNames) != 1 {
				t.Fatalf("single like group actor names = %v", group.ActorNames)
			}
		}
		if len(likeGroups) != 2 || !likeGroups[3] || !likeGroups[1] {
			t.Fatalf("like group sizes = %v", likeGroups)
		}

		// 只筛选回复类：评论、回复与线程活动
		replies, replyTotal, err := Notification.List(&NotificationFilter{
			UserID: owner.ID, Size: 10, TimeZone: "UTC",
			Types: []string{constant.NotificationTypeCommentCreated, constant.NotificationTypeCommentReplied, constant.NotificationTypeCommentThreadReplied},
		})
		if err != nil {
			t.Fatalf("List replies: %v", err)
		}
		if replyTotal != 2 || len(replies) != 2 {
			t.Fatalf("reply groups = %d/%d, want 2", replyTotal, len(replies))
		}
	})
}

// 未读徽标与未读列表按「聚合组」计数；点开一组整组置已读
func TestNotificationUnreadGroupsAndMarkRead(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		owner := notificationTestUser(t, "owner")
		day := time.Date(2026, 11, 8, 3, 0, 0, 0, time.UTC)
		for i, name := range []string{"a1", "a2"} {
			actor := notificationTestUser(t, name)
			makeNotification(t, owner.ID, actor.ID, constant.NotificationTypeCommentLiked, constant.TargetTypeComment, 7, day.Add(time.Duration(i)*time.Hour))
		}
		commenter := notificationTestUser(t, "c1")
		comment := makeNotification(t, owner.ID, commenter.ID, constant.NotificationTypeCommentCreated, constant.TargetTypePost, 12, day.Add(2*time.Hour))

		total, byType, err := Notification.UnreadGroupCount(owner.ID, "UTC")
		if err != nil {
			t.Fatalf("UnreadGroupCount: %v", err)
		}
		if total != 2 || byType[constant.NotificationTypeCommentLiked] != 1 || byType[constant.NotificationTypeCommentCreated] != 1 {
			t.Fatalf("unread = %d, byType = %v", total, byType)
		}

		// 点开点赞组里的代表行 → 两条一起已读
		if _, err := Notification.MarkRead(owner.ID, comment.ID, "UTC"); err != nil {
			t.Fatalf("MarkRead comment: %v", err)
		}
		var unreadLikes int64
		db.Model(&model.Notification{}).Where("user_id = ? AND type = ? AND read_at IS NULL", owner.ID, constant.NotificationTypeCommentLiked).Count(&unreadLikes)
		if unreadLikes != 2 {
			t.Fatalf("likes unread = %d, want 2 before marking the group", unreadLikes)
		}
		var likeRow model.Notification
		if err := db.Where("user_id = ? AND type = ?", owner.ID, constant.NotificationTypeCommentLiked).Order("id DESC").First(&likeRow).Error; err != nil {
			t.Fatalf("load like notification: %v", err)
		}
		affected, err := Notification.MarkRead(owner.ID, likeRow.ID, "UTC")
		if err != nil {
			t.Fatalf("MarkRead like: %v", err)
		}
		if affected != 2 {
			t.Fatalf("MarkRead affected = %d, want the whole group (2)", affected)
		}
		total, _, err = Notification.UnreadGroupCount(owner.ID, "UTC")
		if err != nil {
			t.Fatalf("UnreadGroupCount after read: %v", err)
		}
		if total != 0 {
			t.Fatalf("unread after reading = %d, want 0", total)
		}
	})
}

// 收件人时区不是 UTC 时，列表的分组、整组已读与展开成员对「哪一天」的判断一致：
// 东京时间 11-08 23:00 与 11-09 01:00 的赞分属两组，点开其中一组只标记这一组
func TestNotificationLikeGroupDayConsistentAcrossTimeZones(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		const tz = "Asia/Tokyo"
		owner := notificationTestUser(t, "owner")
		lateNight := time.Date(2026, 11, 8, 14, 0, 0, 0, time.UTC) // 东京 11-08 23:00
		for i, name := range []string{"a1", "a2"} {
			actor := notificationTestUser(t, name)
			makeNotification(t, owner.ID, actor.ID, constant.NotificationTypePostLiked, constant.TargetTypePost, 3, lateNight.Add(time.Duration(i)*30*time.Minute))
		}
		nextDay := notificationTestUser(t, "a3")
		makeNotification(t, owner.ID, nextDay.ID, constant.NotificationTypePostLiked, constant.TargetTypePost, 3, lateNight.Add(2*time.Hour)) // 东京 11-09 01:00

		groups, total, err := Notification.List(&NotificationFilter{UserID: owner.ID, Size: 10, TimeZone: tz})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if total != 2 || len(groups) != 2 || groups[0].Count != 1 || groups[1].Count != 2 {
			t.Fatalf("groups = %d/%d %+v", total, len(groups), groups)
		}
		if len(groups[1].ActorNames) != 2 {
			t.Fatalf("earlier group actor names = %v, want both actors of that day", groups[1].ActorNames)
		}
		affected, err := Notification.MarkRead(owner.ID, groups[1].Notification.ID, tz)
		if err != nil {
			t.Fatalf("MarkRead: %v", err)
		}
		if affected != 2 {
			t.Fatalf("MarkRead affected = %d, want the 2 likes of that day", affected)
		}
		unread, _, err := Notification.UnreadGroupCount(owner.ID, tz)
		if err != nil || unread != 1 {
			t.Fatalf("unread groups = %d (%v), want 1", unread, err)
		}
	})
}

// 折叠行 upsert：同一天同一线程同一收件人只留一行，count 累加、actor 最多两个、读过之后重新变未读
func TestNotificationThreadAggregateUpsert(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		owner := notificationTestUser(t, "owner")
		// actor_id 在 Postgres 上有外键，必须指向真实用户
		actor := notificationTestUser(t, "actor")
		now := time.Now().Truncate(time.Second)
		readAt := now.Add(-time.Hour)
		first := &model.Notification{
			UserID: owner.ID, ActorID: actor.ID, Type: constant.NotificationTypeCommentThreadReplied,
			TargetType: constant.TargetTypeComment, TargetID: 5, CommentID: 5,
			DedupeKey:       "comment.thread_replied:comment:5:day:20261108:user:" + itoa(owner.ID),
			AggregateActors: "甲",
		}
		if err := Notification.UpsertThreadAggregate(nil, first); err != nil {
			t.Fatalf("first upsert: %v", err)
		}
		for _, name := range []string{"乙", "丙"} {
			next := &model.Notification{
				UserID: owner.ID, ActorID: actor.ID, Type: constant.NotificationTypeCommentThreadReplied,
				TargetType: constant.TargetTypeComment, TargetID: 5, CommentID: 5,
				DedupeKey:       first.DedupeKey,
				AggregateActors: name,
			}
			if err := Notification.UpsertThreadAggregate(nil, next); err != nil {
				t.Fatalf("upsert %s: %v", name, err)
			}
		}
		var rows []model.Notification
		if err := db.Where("user_id = ?", owner.ID).Find(&rows).Error; err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 {
			t.Fatalf("rows = %d, want 1 folded row", len(rows))
		}
		row := rows[0]
		if row.AggregateCount != 3 {
			t.Fatalf("aggregate count = %d, want 3", row.AggregateCount)
		}
		if row.AggregateActors != "甲,乙" {
			t.Fatalf("aggregate actors = %q, want only the first two", row.AggregateActors)
		}

		// 已读之后又来一条：read_at 置回 NULL，重新变未读
		if err := db.Model(&model.Notification{}).Where("id = ?", row.ID).Update("read_at", readAt).Error; err != nil {
			t.Fatal(err)
		}
		again := &model.Notification{
			UserID: owner.ID, ActorID: actor.ID, Type: constant.NotificationTypeCommentThreadReplied,
			TargetType: constant.TargetTypeComment, TargetID: 5, CommentID: 5,
			DedupeKey: first.DedupeKey, AggregateActors: "丁",
		}
		if err := Notification.UpsertThreadAggregate(nil, again); err != nil {
			t.Fatalf("upsert after read: %v", err)
		}
		var reloaded model.Notification
		if err := db.Where("id = ?", row.ID).First(&reloaded).Error; err != nil {
			t.Fatal(err)
		}
		if reloaded.ReadAt != nil {
			t.Fatal("folded row should become unread again")
		}
		if reloaded.AggregateCount != 4 {
			t.Fatalf("aggregate count = %d, want 4", reloaded.AggregateCount)
		}
	})
}

func itoa(value uint) string {
	if value == 0 {
		return "0"
	}
	digits := []byte{}
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}

// 取消点赞：按去重键硬删通知行，事件本身保留（事件是事实）
func TestNotificationDeleteByEvent(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		owner := notificationTestUser(t, "owner")
		actor := notificationTestUser(t, "actor")
		event, err := Notification.CreateEvent(nil, &model.InteractionEvent{
			Type: constant.NotificationTypePostLiked, ActorID: actor.ID, OwnerID: owner.ID,
			TargetType: constant.TargetTypePost, TargetID: 12, DedupeKey: "post.liked:post:12:user:1",
		})
		if err != nil {
			t.Fatalf("CreateEvent: %v", err)
		}
		// 同一去重键重复写入复用已有事件
		again, err := Notification.CreateEvent(nil, &model.InteractionEvent{
			Type: constant.NotificationTypePostLiked, ActorID: actor.ID, OwnerID: owner.ID,
			TargetType: constant.TargetTypePost, TargetID: 12, DedupeKey: "post.liked:post:12:user:1",
		})
		if err != nil || again.ID != event.ID {
			t.Fatalf("duplicate event = %+v, err = %v", again, err)
		}
		notification := &model.Notification{
			EventID: event.ID, UserID: owner.ID, ActorID: actor.ID, Type: constant.NotificationTypePostLiked,
			TargetType: constant.TargetTypePost, TargetID: 12, DedupeKey: event.DedupeKey,
		}
		// 唯一索引让重复写入变成空操作
		for i := 0; i < 2; i++ {
			if err := Notification.CreateNotification(nil, notification); err != nil {
				t.Fatalf("CreateNotification: %v", err)
			}
			notification.ID = 0
		}
		var count int64
		db.Model(&model.Notification{}).Where("user_id = ?", owner.ID).Count(&count)
		if count != 1 {
			t.Fatalf("notifications = %d, want 1", count)
		}
		if err := Notification.DeleteNotificationByDedupe(nil, event.DedupeKey, owner.ID); err != nil {
			t.Fatalf("DeleteNotificationByDedupe: %v", err)
		}
		// 硬删：连 Unscoped 都查不到，重复点赞才不会撞唯一索引
		db.Unscoped().Model(&model.Notification{}).Where("user_id = ?", owner.ID).Count(&count)
		if count != 0 {
			t.Fatalf("notifications after delete = %d, want 0", count)
		}
	})
}
