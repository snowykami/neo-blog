package repo

import (
	"slices"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 点赞用户列表按点赞时间倒序，limit 只保留最近点赞的人
func TestGetLikedUsersNewestFirst(t *testing.T) {
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

		author := &model.User{Username: "author", Email: "author@example.com"}
		mustCreate(author)
		post := &model.Post{UserID: author.ID, PostBase: model.PostBase{Title: "post"}}
		mustCreate(post)

		// 按用户 ID 顺序创建，但点赞时间打乱，确认排序依据的是点赞时间而不是插入顺序
		base := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
		offsets := map[string]time.Duration{"u1": 3 * time.Hour, "u2": time.Hour, "u3": 4 * time.Hour, "u4": 2 * time.Hour}
		for _, name := range []string{"u1", "u2", "u3", "u4"} {
			user := &model.User{Username: name, Email: name + "@example.com"}
			mustCreate(user)
			like := &model.Like{UserID: user.ID, TargetType: constant.TargetTypePost, TargetID: post.ID}
			like.CreatedAt = base.Add(offsets[name])
			mustCreate(like)
		}

		users, err := Like.GetLikedUsers(post.ID, constant.TargetTypePost, 3)
		if err != nil {
			t.Fatalf("GetLikedUsers: %v", err)
		}
		var got []string
		for _, u := range users {
			got = append(got, u.Username)
		}
		if want := []string{"u3", "u1", "u4"}; !slices.Equal(got, want) {
			t.Fatalf("GetLikedUsers = %v, want %v", got, want)
		}
	})
}
