package service

import (
	"context"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// expectHubSignal 断言某个订阅在 action 之后收到（或没有收到）实时推送；先清掉之前积压的信号
func expectHubSignal(t *testing.T, ch <-chan struct{}, want bool, name string, action func()) {
	t.Helper()
	select {
	case <-ch:
	default:
	}
	action()
	select {
	case <-ch:
		if !want {
			t.Fatalf("%s: unexpected realtime signal", name)
		}
	case <-time.After(200 * time.Millisecond):
		if want {
			t.Fatalf("%s: expected a realtime signal", name)
		}
	}
}

func countNotifications(t *testing.T, query string, args ...any) int64 {
	t.Helper()
	var count int64
	if err := repo.GetDB().Unscoped().Model(&model.Notification{}).Where(query, args...).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	return count
}

// 标记已读、全部已读、取消点赞、测试通知都推送一次，其他标签页的徽标随之同步；没有变化时不推送
func TestNotificationChangesPushRealtime(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	authorID, _ := ctxutils.GetCurrentUserID(author)
	adminID, _ := ctxutils.GetCurrentUserID(admin)
	postID := createPublicPost(t, author, nil)
	ch, unsubscribe := NotificationHub.Subscribe(authorID)
	defer unsubscribe()

	expectHubSignal(t, ch, true, "like", func() {
		if _, svcerr := NewLikeService().ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil {
			t.Fatalf("like: %v", svcerr)
		}
	})
	var row model.Notification
	if err := repo.GetDB().Where("user_id = ?", authorID).First(&row).Error; err != nil {
		t.Fatalf("like notification: %v", err)
	}
	notifications := NewNotificationService()
	expectHubSignal(t, ch, true, "mark read", func() {
		if _, svcerr := notifications.MarkNotificationRead(author, row.ID); svcerr != nil {
			t.Fatalf("mark read: %v", svcerr)
		}
	})
	expectHubSignal(t, ch, false, "mark read again", func() {
		if _, svcerr := notifications.MarkNotificationRead(author, row.ID); svcerr != nil {
			t.Fatalf("mark read again: %v", svcerr)
		}
	})
	expectHubSignal(t, ch, true, "unlike", func() {
		if _, svcerr := NewLikeService().ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil {
			t.Fatalf("unlike: %v", svcerr)
		}
	})
	if countNotifications(t, "user_id = ?", authorID) != 0 {
		t.Fatal("like notification should be revoked")
	}

	// 全部已读只标 before_id 及更早的：之后新到的保持未读
	if _, svcerr := createComment(other, postID, 0, false); svcerr != nil {
		t.Fatalf("comment: %v", svcerr)
	}
	var first model.Notification
	repo.GetDB().Where("user_id = ?", authorID).Order("id DESC").First(&first)
	if _, svcerr := createComment(other, postID, 0, false); svcerr != nil {
		t.Fatalf("comment: %v", svcerr)
	}
	before := first.ID
	expectHubSignal(t, ch, true, "mark all read", func() {
		affected, svcerr := notifications.MarkAllNotificationsRead(author, &dto.MarkAllNotificationsReadReq{BeforeID: &before})
		if svcerr != nil || affected != 1 {
			t.Fatalf("mark all read: %d %v", affected, svcerr)
		}
	})
	if unread := countNotifications(t, "user_id = ? AND read_at IS NULL", authorID); unread != 1 {
		t.Fatalf("unread after mark all with before_id = %d, want 1", unread)
	}
	expectHubSignal(t, ch, false, "mark all read with nothing left", func() {
		if _, svcerr := notifications.MarkAllNotificationsRead(author, &dto.MarkAllNotificationsReadReq{BeforeID: &before}); svcerr != nil {
			t.Fatalf("mark all read again: %v", svcerr)
		}
	})

	// 后台测试通知同样走实时推送
	adminCh, unsubscribeAdmin := NotificationHub.Subscribe(adminID)
	defer unsubscribeAdmin()
	expectHubSignal(t, adminCh, true, "test notification", func() {
		if svcerr := notifications.SendTestNotification(admin); svcerr != nil {
			t.Fatalf("test notification: %v", svcerr)
		}
	})
}

// 编辑评论：新加的 @ 补发提及通知（重复编辑不重复），改为私密后收回看不到它的人的通知
func TestUpdateCommentSyncsNotifications(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	authorID, _ := ctxutils.GetCurrentUserID(author)
	postID := createPublicPost(t, author, nil)
	mentioned := createNotificationUser(t, "mentioned", nil)
	outsider := createNotificationUser(t, "outsider", nil)

	commentID, svcerr := NewCommentService().CreateComment(other, &dto.CreateCommentReq{
		TargetID: postID, TargetType: constant.TargetTypePost, Content: "第一版",
	})
	if svcerr != nil {
		t.Fatalf("create comment: %v", svcerr)
	}
	update := func(content string, mentions []uint, private bool) {
		t.Helper()
		if svcerr := NewCommentService().UpdateComment(other, &dto.UpdateCommentReq{
			ID: commentID, Content: content, MentionUserIDs: &mentions, IsPrivate: private,
		}); svcerr != nil {
			t.Fatalf("update comment: %v", svcerr)
		}
	}
	mentionCount := func(userID uint) int64 {
		return countNotifications(t, "user_id = ? AND type = ? AND comment_id = ?", userID, constant.NotificationTypeCommentMentioned, commentID)
	}

	ch, unsubscribe := NotificationHub.Subscribe(mentioned.ID)
	defer unsubscribe()
	expectHubSignal(t, ch, true, "add mention", func() {
		update("@mentioned 来看看 @outsider", []uint{mentioned.ID, outsider.ID}, false)
	})
	if mentionCount(mentioned.ID) != 1 || mentionCount(outsider.ID) != 1 {
		t.Fatalf("mention notifications = %d / %d, want 1 / 1", mentionCount(mentioned.ID), mentionCount(outsider.ID))
	}
	// 再编辑一次（提及不变）：不重复通知，也不推送
	expectHubSignal(t, ch, false, "edit again", func() {
		update("@mentioned 来看看 @outsider！", []uint{mentioned.ID, outsider.ID}, false)
	})
	if mentionCount(mentioned.ID) != 1 {
		t.Fatalf("mention notifications after re-edit = %d, want 1", mentionCount(mentioned.ID))
	}
	// 文章作者已经收到评论通知，后来被 @ 也不再收提及
	update("@mentioned @outsider @author", []uint{mentioned.ID, outsider.ID, authorID}, false)
	if mentionCount(authorID) != 0 {
		t.Fatal("post author already notified by comment.created should not get a mention")
	}

	// 参与线程的人（mentioned 回复过这条评论）能看到私密评论，outsider 看不到
	if _, svcerr := NewCommentService().CreateComment(ctxWithUser(mentioned.ID), &dto.CreateCommentReq{
		TargetID: postID, TargetType: constant.TargetTypePost, Content: "回复", ReplyID: commentID,
	}); svcerr != nil {
		t.Fatalf("reply: %v", svcerr)
	}
	outsiderCh, unsubscribeOutsider := NotificationHub.Subscribe(outsider.ID)
	defer unsubscribeOutsider()
	expectHubSignal(t, outsiderCh, true, "make private", func() {
		update("@mentioned @outsider @author", []uint{mentioned.ID, outsider.ID, authorID}, true)
	})
	if mentionCount(outsider.ID) != 0 {
		t.Fatal("outsider's mention should be revoked after the comment became private")
	}
	if mentionCount(mentioned.ID) != 1 {
		t.Fatal("thread participant should keep the mention")
	}
	if countNotifications(t, "user_id = ? AND type = ? AND comment_id = ?", authorID, constant.NotificationTypeCommentCreated, commentID) != 1 {
		t.Fatal("post author should keep the comment notification")
	}
}

// 删除文章：文章点赞、评论、回复等通知一并删除，收件人收到推送
func TestDeletePostCleansNotifications(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	authorID, _ := ctxutils.GetCurrentUserID(author)
	otherID, _ := ctxutils.GetCurrentUserID(other)
	postID := createPublicPost(t, author, nil)
	keepID := createPublicPost(t, author, nil)

	if _, svcerr := NewLikeService().ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil {
		t.Fatalf("like: %v", svcerr)
	}
	rootID, svcerr := createComment(other, postID, 0, false)
	if svcerr != nil {
		t.Fatalf("comment: %v", svcerr)
	}
	if _, svcerr := createComment(author, postID, rootID, false); svcerr != nil {
		t.Fatalf("reply: %v", svcerr)
	}
	if _, svcerr := NewLikeService().ToggleLike(author, rootID, constant.TargetTypeComment, nil); svcerr != nil {
		t.Fatalf("like comment: %v", svcerr)
	}
	if _, svcerr := createComment(other, keepID, 0, false); svcerr != nil {
		t.Fatalf("comment on other post: %v", svcerr)
	}
	if countNotifications(t, "subject_type = ? AND subject_id = ?", constant.TargetTypePost, postID) < 4 {
		t.Fatal("expected notifications on the post before deleting it")
	}

	ch, unsubscribe := NotificationHub.Subscribe(otherID)
	defer unsubscribe()
	expectHubSignal(t, ch, true, "delete post", func() {
		if svcerr := NewPostService().DeletePost(admin, postID); svcerr != nil {
			t.Fatalf("delete post: %v", svcerr)
		}
	})
	if n := countNotifications(t, "subject_type = ? AND subject_id = ?", constant.TargetTypePost, postID); n != 0 {
		t.Fatalf("notifications of deleted post = %d, want 0", n)
	}
	if n := countNotifications(t, "comment_id = ? OR (target_type = ? AND target_id = ?)", rootID, constant.TargetTypeComment, rootID); n != 0 {
		t.Fatalf("notifications of deleted comments = %d, want 0", n)
	}
	// 其他文章的通知不受影响
	if n := countNotifications(t, "user_id = ? AND subject_id = ?", authorID, keepID); n != 1 {
		t.Fatalf("notifications of the other post = %d, want 1", n)
	}
}

func ctxWithUser(userID uint) context.Context {
	return context.WithValue(context.Background(), "user_id", userID)
}
