package repo

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

// emitThreadReply 模拟一次回复在同一个事务里写入的线程活动：复用事件 + 折叠行 upsert
func emitThreadReply(tx *gorm.DB, ownerID, actorID uint, dedupeKey, actorName string) error {
	event, err := Notification.CreateEvent(tx, &model.InteractionEvent{
		Type: constant.NotificationTypeCommentThreadReplied, ActorID: actorID, OwnerID: ownerID,
		TargetType: constant.TargetTypeComment, TargetID: 5, DedupeKey: dedupeKey,
	})
	if err != nil {
		return err
	}
	return Notification.UpsertThreadAggregate(tx, &model.Notification{
		EventID: event.ID, UserID: ownerID, ActorID: actorID, Type: constant.NotificationTypeCommentThreadReplied,
		TargetType: constant.TargetTypeComment, TargetID: 5, CommentID: 5,
		DedupeKey: event.DedupeKey, AggregateActors: actorName,
	})
}

func loadThreadAggregate(t *testing.T, ownerID uint, dedupeKey string) model.Notification {
	t.Helper()
	var rows []model.Notification
	if err := db.Where("user_id = ? AND dedupe_key = ?", ownerID, dedupeKey).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("folded rows = %d, want 1", len(rows))
	}
	return rows[0]
}

// 两人同时回复同一线程：后到的事务在唯一索引上等待先到的提交，之后不能因冲突而整体失败（Postgres 下失败语句会让事务作废）
func TestThreadAggregateInterleavedReplies(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		owner := notificationTestUser(t, "owner")
		alice := notificationTestUser(t, "alice")
		bob := notificationTestUser(t, "bob")
		dedupeKey := "comment.thread_replied:comment:5:day:20261110:user:" + itoa(owner.ID)

		first := db.Begin()
		if err := first.Create(&model.Label{Name: "reply-a", Slug: "reply-a"}).Error; err != nil {
			first.Rollback()
			t.Fatalf("first parent write: %v", err)
		}
		if err := emitThreadReply(first, owner.ID, alice.ID, dedupeKey, "甲"); err != nil {
			first.Rollback()
			t.Fatalf("first emit: %v", err)
		}

		done := make(chan error, 1)
		go func() {
			done <- db.Transaction(func(tx *gorm.DB) error {
				if err := emitThreadReply(tx, owner.ID, bob.ID, dedupeKey, "乙"); err != nil {
					return err
				}
				// 通知之后父事务还要继续写（相当于评论写完后的其它语句）
				return tx.Create(&model.Label{Name: "reply-b", Slug: "reply-b"}).Error
			})
		}()
		// 让第二个事务先撞上未提交的行再提交第一个
		time.Sleep(300 * time.Millisecond)
		if err := first.Commit().Error; err != nil {
			t.Fatalf("first commit: %v", err)
		}
		if err := <-done; err != nil {
			t.Fatalf("second reply transaction failed: %v", err)
		}

		var labels int64
		db.Model(&model.Label{}).Where("slug IN ?", []string{"reply-a", "reply-b"}).Count(&labels)
		if labels != 2 {
			t.Fatalf("parent writes committed = %d, want 2", labels)
		}
		row := loadThreadAggregate(t, owner.ID, dedupeKey)
		if row.AggregateCount != 2 {
			t.Fatalf("aggregate count = %d, want 2", row.AggregateCount)
		}
		if row.AggregateActors != "甲,乙" {
			t.Fatalf("aggregate actors = %q, want 甲,乙", row.AggregateActors)
		}
		var events int64
		db.Model(&model.InteractionEvent{}).Where("dedupe_key = ?", dedupeKey).Count(&events)
		if events != 1 {
			t.Fatalf("events = %d, want 1", events)
		}
	})
}

// 多人并发回复同一线程：每个事务都提交，折叠行计数等于回复数
func TestThreadAggregateConcurrentReplies(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		owner := notificationTestUser(t, "owner")
		dedupeKey := "comment.thread_replied:comment:5:day:20261110:user:" + itoa(owner.ID)
		const n = 8
		actors := make([]*model.User, n)
		for i := range actors {
			actors[i] = notificationTestUser(t, fmt.Sprintf("actor%d", i))
		}
		var wg sync.WaitGroup
		errCh := make(chan error, n)
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				errCh <- db.Transaction(func(tx *gorm.DB) error {
					slug := fmt.Sprintf("reply-%d", i)
					if err := tx.Create(&model.Label{Name: slug, Slug: slug}).Error; err != nil {
						return err
					}
					if err := emitThreadReply(tx, owner.ID, actors[i].ID, dedupeKey, actors[i].Username); err != nil {
						return err
					}
					return tx.Model(&model.Label{}).Where("slug = ?", slug).Update("tailwind_class_name", "done").Error
				})
			}(i)
		}
		wg.Wait()
		close(errCh)
		for err := range errCh {
			if err != nil {
				t.Fatalf("reply transaction failed: %v", err)
			}
		}
		var labels int64
		db.Model(&model.Label{}).Where("tailwind_class_name = ?", "done").Count(&labels)
		if labels != n {
			t.Fatalf("committed replies = %d, want %d", labels, n)
		}
		row := loadThreadAggregate(t, owner.ID, dedupeKey)
		if row.AggregateCount != n {
			t.Fatalf("aggregate count = %d, want %d", row.AggregateCount, n)
		}
		if len(splitAggregateActors(row.AggregateActors)) != 2 {
			t.Fatalf("aggregate actors = %q, want two names", row.AggregateActors)
		}
	})
}

// 同一事件的通知并发写入：后到的事务不报错，只留一行
func TestCreateNotificationInterleaved(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		owner := notificationTestUser(t, "owner")
		actor := notificationTestUser(t, "actor")
		dedupeKey := "comment.mentioned:comment:9:user:" + itoa(owner.ID)
		write := func(tx *gorm.DB) error {
			event, err := Notification.CreateEvent(tx, &model.InteractionEvent{
				Type: constant.NotificationTypeCommentMentioned, ActorID: actor.ID, OwnerID: owner.ID, DedupeKey: dedupeKey,
			})
			if err != nil {
				return err
			}
			if err := Notification.CreateNotification(tx, &model.Notification{
				EventID: event.ID, UserID: owner.ID, ActorID: actor.ID, Type: constant.NotificationTypeCommentMentioned,
				DedupeKey: event.DedupeKey,
			}); err != nil {
				return err
			}
			var count int64
			return tx.Model(&model.Notification{}).Where("user_id = ?", owner.ID).Count(&count).Error
		}
		first := db.Begin()
		if err := write(first); err != nil {
			first.Rollback()
			t.Fatalf("first write: %v", err)
		}
		done := make(chan error, 1)
		go func() { done <- db.Transaction(write) }()
		time.Sleep(300 * time.Millisecond)
		if err := first.Commit().Error; err != nil {
			t.Fatalf("first commit: %v", err)
		}
		if err := <-done; err != nil {
			t.Fatalf("second transaction failed: %v", err)
		}
		var count int64
		db.Model(&model.Notification{}).Where("user_id = ?", owner.ID).Count(&count)
		if count != 1 {
			t.Fatalf("notifications = %d, want 1", count)
		}
	})
}

// 嵌套事务（savepoint）里的失败语句只回滚它自己，外层事务照常提交（通知写失败不影响评论 / 点赞，见 5.3）
func TestNestedTransactionIsolatesFailure(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		notificationTestUser(t, "taken")
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&model.Label{Name: "outer", Slug: "outer"}).Error; err != nil {
				return err
			}
			innerErr := tx.Transaction(func(sp *gorm.DB) error {
				// 用户名唯一：这条一定失败
				return sp.Create(&model.User{Username: "taken", Email: "taken2@example.com"}).Error
			})
			if innerErr == nil {
				t.Error("inner insert should fail")
			}
			return tx.Model(&model.Label{}).Where("slug = ?", "outer").Update("tailwind_class_name", "after").Error
		})
		if err != nil {
			t.Fatalf("outer transaction: %v", err)
		}
		var label model.Label
		if err := db.Where("slug = ?", "outer").First(&label).Error; err != nil || label.TailwindClassName != "after" {
			t.Fatalf("outer write = %+v, err = %v", label, err)
		}
	})
}

// 并发点赞：同一用户的重复点赞不报错，不同用户的点赞全部提交，计数与实际记录一致
func TestToggleLikeConcurrent(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		author := notificationTestUser(t, "author")
		post := &model.Post{UserID: author.ID, PostBase: model.PostBase{Title: "post"}}
		if err := db.Create(post).Error; err != nil {
			t.Fatal(err)
		}

		// 同一用户两个事务交错点赞：后到的不能因唯一索引冲突让事务作废
		liker := notificationTestUser(t, "liker")
		first := db.Begin()
		if _, err := Like.ToggleLike(liker.ID, post.ID, constant.TargetTypePost, first); err != nil {
			first.Rollback()
			t.Fatalf("first toggle: %v", err)
		}
		done := make(chan error, 1)
		go func() {
			done <- db.Transaction(func(tx *gorm.DB) error {
				if _, err := Like.ToggleLike(liker.ID, post.ID, constant.TargetTypePost, tx); err != nil {
					return err
				}
				return tx.Create(&model.Label{Name: "after-like", Slug: "after-like"}).Error
			})
		}()
		time.Sleep(300 * time.Millisecond)
		if err := first.Commit().Error; err != nil {
			t.Fatalf("first commit: %v", err)
		}
		if err := <-done; err != nil {
			t.Fatalf("second toggle transaction failed: %v", err)
		}
		assertLikeCount(t, post.ID)

		// 多个用户同时点赞同一篇文章
		const n = 8
		users := make([]*model.User, n)
		for i := range users {
			users[i] = notificationTestUser(t, fmt.Sprintf("fan%d", i))
		}
		var wg sync.WaitGroup
		errCh := make(chan error, n)
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func(user *model.User) {
				defer wg.Done()
				errCh <- db.Transaction(func(tx *gorm.DB) error {
					liked, err := Like.ToggleLike(user.ID, post.ID, constant.TargetTypePost, tx)
					if err != nil {
						return err
					}
					if !liked {
						return fmt.Errorf("user %d should be liked", user.ID)
					}
					dedupeKey := fmt.Sprintf("post.liked:post:%d:user:%d", post.ID, user.ID)
					event, err := Notification.CreateEvent(tx, &model.InteractionEvent{
						Type: constant.NotificationTypePostLiked, ActorID: user.ID, OwnerID: author.ID,
						TargetType: constant.TargetTypePost, TargetID: post.ID, DedupeKey: dedupeKey,
					})
					if err != nil {
						return err
					}
					return Notification.CreateNotification(tx, &model.Notification{
						EventID: event.ID, UserID: author.ID, ActorID: user.ID, Type: constant.NotificationTypePostLiked,
						TargetType: constant.TargetTypePost, TargetID: post.ID, DedupeKey: dedupeKey,
					})
				})
			}(users[i])
		}
		wg.Wait()
		close(errCh)
		for err := range errCh {
			if err != nil {
				t.Fatalf("like transaction failed: %v", err)
			}
		}
		var fans int64
		db.Model(&model.Like{}).Where("target_type = ? AND target_id = ? AND user_id IN ?", constant.TargetTypePost, post.ID,
			[]uint{users[0].ID, users[1].ID, users[2].ID, users[3].ID, users[4].ID, users[5].ID, users[6].ID, users[7].ID}).Count(&fans)
		if fans != n {
			t.Fatalf("committed likes = %d, want %d", fans, n)
		}
		var notifications int64
		db.Model(&model.Notification{}).Where("user_id = ? AND type = ?", author.ID, constant.NotificationTypePostLiked).Count(&notifications)
		if notifications != n {
			t.Fatalf("like notifications = %d, want %d", notifications, n)
		}
		assertLikeCount(t, post.ID)
	})
}

// assertLikeCount 文章上的点赞数必须等于实际点赞记录数
func assertLikeCount(t *testing.T, postID uint) {
	t.Helper()
	var actual int64
	db.Model(&model.Like{}).Where("target_type = ? AND target_id = ?", constant.TargetTypePost, postID).Count(&actual)
	var post model.Post
	if err := db.Where("id = ?", postID).First(&post).Error; err != nil {
		t.Fatal(err)
	}
	if int64(post.LikeCount) != actual {
		t.Fatalf("post like_count = %d, actual likes = %d", post.LikeCount, actual)
	}
}
