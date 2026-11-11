package repo

import (
	"testing"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

// 删除有评论、点赞、Token、修订、协作关系、AI 配置的用户：Postgres 会校验外键，残留引用会让删除失败
func TestDeleteUserWithRelatedRecords(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		mustCreate := func(value any) {
			t.Helper()
			if err := db.Create(value).Error; err != nil {
				t.Fatalf("create %T: %v", value, err)
			}
		}

		admin := &model.User{Username: "admin", Email: "admin@example.com", Role: constant.RoleAdmin}
		target := &model.User{Username: "target", Email: "target@example.com"}
		other := &model.User{Username: "other", Email: "other@example.com"}
		mustCreate(admin)
		mustCreate(target)
		mustCreate(other)

		post := &model.Post{UserID: other.ID, PostBase: model.PostBase{Title: "post"}}
		mustCreate(post)
		if err := db.Model(post).Association("Collaborators").Append(target); err != nil {
			t.Fatalf("append collaborator: %v", err)
		}

		comment := func(userID, replyID uint) *model.Comment {
			c := &model.Comment{UserID: userID, TargetID: post.ID, TargetType: constant.TargetTypePost, ReplyID: replyID}
			mustCreate(c)
			return c
		}
		otherRoot := comment(other.ID, 0)
		comment(target.ID, otherRoot.ID) // 回复别人的评论
		targetRoot := comment(target.ID, 0)
		otherReply := comment(other.ID, targetRoot.ID) // 别人回复目标用户的评论
		comment(target.ID, otherReply.ID)              // 级联删除时一并软删除的自己的回复
		deleted := comment(target.ID, 0)               // 此前已软删除的评论
		if err := db.Delete(deleted).Error; err != nil {
			t.Fatalf("soft delete comment: %v", err)
		}
		if err := db.Model(otherRoot).UpdateColumn("comment_count", 1).Error; err != nil {
			t.Fatalf("set comment_count: %v", err)
		}

		mustCreate(&model.Like{UserID: target.ID, TargetType: constant.TargetTypePost, TargetID: post.ID})
		token := &model.APIToken{UserID: target.ID, Name: "token", TokenHash: "hash"}
		mustCreate(token)
		mustCreate(&model.ContentRevision{TargetType: constant.TargetTypePost, TargetID: post.ID, UserID: target.ID, APITokenID: &token.ID})
		mustCreate(&model.EditSession{TargetType: constant.TargetTypePost, TargetID: post.ID, SessionID: "s", UserID: target.ID, APITokenID: &token.ID})
		mustCreate(&model.AIAgent{UserID: target.ID})

		// 目标用户点赞了别人的文章（作为触发者），别人回复了目标用户（作为收件人），另有一条与目标用户无关的通知
		likedEvent := &model.InteractionEvent{Type: "post.liked", ActorID: target.ID, OwnerID: other.ID, DedupeKey: "like-target"}
		mustCreate(likedEvent)
		mustCreate(&model.Notification{EventID: likedEvent.ID, UserID: other.ID, ActorID: target.ID, DedupeKey: "like-target"})
		repliedEvent := &model.InteractionEvent{Type: "comment.replied", ActorID: other.ID, OwnerID: target.ID, DedupeKey: "reply-target"}
		mustCreate(repliedEvent)
		mustCreate(&model.Notification{EventID: repliedEvent.ID, UserID: target.ID, ActorID: other.ID, DedupeKey: "reply-target"})
		unrelatedEvent := &model.InteractionEvent{Type: "post.liked", ActorID: other.ID, OwnerID: admin.ID, DedupeKey: "like-admin"}
		mustCreate(unrelatedEvent)
		mustCreate(&model.Notification{EventID: unrelatedEvent.ID, UserID: admin.ID, ActorID: other.ID, DedupeKey: "like-admin"})

		if err := User.DeleteUser(target.ID, admin.ID); err != nil {
			t.Fatalf("delete user: %v", err)
		}

		assertCount := func(name string, query *gorm.DB, want int64) {
			t.Helper()
			var count int64
			if err := query.Count(&count).Error; err != nil {
				t.Fatalf("count %s: %v", name, err)
			}
			if count != want {
				t.Errorf("%s = %d, want %d", name, count, want)
			}
		}
		assertCount("users", db.Unscoped().Model(&model.User{}).Where("id = ?", target.ID), 0)
		assertCount("comments", db.Unscoped().Model(&model.Comment{}).Where("user_id = ?", target.ID), 0)
		assertCount("visible comments", db.Model(&model.Comment{}), 1)
		assertCount("api tokens", db.Unscoped().Model(&model.APIToken{}).Where("user_id = ?", target.ID), 0)
		assertCount("collaborators", db.Table("post_collaborators").Where("user_id = ?", target.ID), 0)
		assertCount("ai agents", db.Model(&model.AIAgent{}).Where("user_id = ?", target.ID), 0)
		assertCount("notifications of the user", db.Unscoped().Model(&model.Notification{}).Where("user_id = ? OR actor_id = ?", target.ID, target.ID), 0)
		assertCount("events of the user", db.Unscoped().Model(&model.InteractionEvent{}).Where("actor_id = ? OR owner_id = ?", target.ID, target.ID), 0)
		assertCount("unrelated notifications", db.Model(&model.Notification{}), 1)
		assertCount("transferred revisions", db.Model(&model.ContentRevision{}).Where("user_id = ? AND api_token_id IS NULL", admin.ID), 1)

		var reloadedPost model.Post
		if err := db.First(&reloadedPost, post.ID).Error; err != nil {
			t.Fatalf("reload post: %v", err)
		}
		if reloadedPost.CommentCount != 1 {
			t.Errorf("post comment_count = %d, want 1", reloadedPost.CommentCount)
		}
		var reloadedRoot model.Comment
		if err := db.First(&reloadedRoot, otherRoot.ID).Error; err != nil {
			t.Fatalf("reload comment: %v", err)
		}
		if reloadedRoot.CommentCount != 0 {
			t.Errorf("comment comment_count = %d, want 0", reloadedRoot.CommentCount)
		}
	})
}
