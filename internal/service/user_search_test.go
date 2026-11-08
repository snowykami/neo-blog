package service

import (
	"context"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
)

// 提及搜索：按用户名 / 昵称模糊匹配，排除自己与已禁用账号，完全匹配排最前
func TestSearchUsers(t *testing.T) {
	setupNotificationDB(t)
	me := createNotificationUser(t, "snowy", nil)
	other := createNotificationUser(t, "snowykami", func(u *model.User) { u.Nickname = "千束" })
	createNotificationUser(t, "snowman", nil)
	disabled := createNotificationUser(t, "snowflake", func(u *model.User) { u.Disabled = true })
	ctxOf := func(user *model.User) context.Context {
		return context.WithValue(context.Background(), "user_id", user.ID)
	}

	// 未登录不可用：这个接口只给评论的人用
	if _, svcerr := NewUserService().SearchUsers(context.Background(), &dto.SearchUsersReq{Query: "snow"}); svcerr == nil || svcerr.Code != 401 {
		t.Fatalf("anonymous search = %v, want 401", svcerr)
	}

	users, svcerr := NewUserService().SearchUsers(ctxOf(me), &dto.SearchUsersReq{Query: "snow", Limit: 10})
	if svcerr != nil {
		t.Fatalf("search: %v", svcerr)
	}
	names := make([]string, 0, len(users))
	for _, user := range users {
		names = append(names, user.Username)
	}
	// 自己不出现，禁用账号不出现
	for _, name := range names {
		if name == me.Username {
			t.Error("should not include myself")
		}
		if name == disabled.Username {
			t.Error("should not include disabled users")
		}
	}
	if len(names) != 2 {
		t.Fatalf("results = %v, want snowman + snowykami", names)
	}

	// 按昵称也能搜到；完全匹配昵称时排最前
	byNickname, svcerr := NewUserService().SearchUsers(ctxOf(me), &dto.SearchUsersReq{Query: "千束"})
	if svcerr != nil || len(byNickname) != 1 || byNickname[0].ID != other.ID {
		t.Fatalf("search by nickname = %+v, %v", byNickname, svcerr)
	}
	if byNickname[0].Nickname != "千束" {
		t.Fatalf("nickname = %q", byNickname[0].Nickname)
	}

	// LIKE 通配符按字面匹配，不会把所有人都搜出来
	all, svcerr := NewUserService().SearchUsers(ctxOf(me), &dto.SearchUsersReq{Query: "%"})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	if len(all) != 0 {
		t.Fatalf("wildcard should be escaped, got %d results", len(all))
	}

	// 空关键词不返回任何人
	empty, svcerr := NewUserService().SearchUsers(ctxOf(me), &dto.SearchUsersReq{Query: "  "})
	if svcerr != nil || len(empty) != 0 {
		t.Fatalf("empty query = %v, %v", empty, svcerr)
	}
}
