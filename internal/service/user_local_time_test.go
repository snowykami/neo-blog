package service

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
)

func TestUpdateUserLocalTime(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	authorID := mustUserID(t, author)
	svc := NewUserService()
	on, off := true, false

	// 返回给不同查看者的用户信息，以及序列化后是否带有时区字段
	viewAs := func(ctx context.Context) (dto.UserDto, bool) {
		t.Helper()
		resp, svcerr := svc.GetUser(ctx, &dto.GetUserReq{UserID: authorID})
		if svcerr != nil {
			t.Fatalf("get user: %v", svcerr)
		}
		raw, _ := json.Marshal(resp.User)
		return resp.User, strings.Contains(string(raw), `"time_zone"`)
	}
	stored := func() model.User {
		t.Helper()
		var u model.User
		if err := repo.GetDB().First(&u, authorID).Error; err != nil {
			t.Fatalf("load user: %v", err)
		}
		return u
	}

	// 默认不公开
	if u := stored(); u.ShowLocalTime == nil || *u.ShowLocalTime || u.TimeZone != "" {
		t.Fatalf("expected local time hidden by default, got %v %q", u.ShowLocalTime, u.TimeZone)
	}
	if _, has := viewAs(context.Background()); has {
		t.Fatal("guest should not see time_zone by default")
	}

	// 开启时必须带上有效的 IANA 时区
	for _, tz := range []string{"", "  ", "Local", "EST", "Asia/tokyo", "Mars/Olympus", "../../etc/passwd", strings.Repeat("A", 65)} {
		_, svcerr := svc.UpdateUser(&dto.UpdateUserReq{ID: authorID, ShowLocalTime: &on, TimeZone: tz})
		expectSvcErr(t, svcerr, http.StatusBadRequest, "invalid_timezone")
	}
	if u := stored(); *u.ShowLocalTime || u.TimeZone != "" {
		t.Fatalf("invalid time zone should not be saved, got %v %q", *u.ShowLocalTime, u.TimeZone)
	}

	if _, svcerr := svc.UpdateUser(&dto.UpdateUserReq{ID: authorID, ShowLocalTime: &on, TimeZone: " Asia/Tokyo "}); svcerr != nil {
		t.Fatalf("enable local time: %v", svcerr)
	}
	for _, ctx := range []context.Context{context.Background(), other, author} {
		if u, _ := viewAs(ctx); u.TimeZone != "Asia/Tokyo" || u.ShowLocalTime == nil || !*u.ShowLocalTime {
			t.Fatalf("expected Asia/Tokyo visible, got %v %q", u.ShowLocalTime, u.TimeZone)
		}
	}
	// 评论、文章作者等场景使用的公开信息不带时区
	if u := stored(); u.ToDto().TimeZone != "" {
		t.Fatal("time zone should only be returned by profile endpoints")
	}

	// 不带开关的更新（如只改昵称）不影响当地时间设置
	if _, svcerr := svc.UpdateUser(&dto.UpdateUserReq{ID: authorID, Nickname: "Author"}); svcerr != nil {
		t.Fatalf("update nickname: %v", svcerr)
	}
	if u := stored(); !*u.ShowLocalTime || u.TimeZone != "Asia/Tokyo" {
		t.Fatalf("local time setting should be kept, got %v %q", *u.ShowLocalTime, u.TimeZone)
	}

	// 关闭后清空时区，任何人都拿不到
	if _, svcerr := svc.UpdateUser(&dto.UpdateUserReq{ID: authorID, ShowLocalTime: &off, TimeZone: "Asia/Tokyo"}); svcerr != nil {
		t.Fatalf("disable local time: %v", svcerr)
	}
	if u := stored(); *u.ShowLocalTime || u.TimeZone != "" {
		t.Fatalf("time zone should be cleared, got %v %q", *u.ShowLocalTime, u.TimeZone)
	}
	for _, ctx := range []context.Context{context.Background(), author} {
		if _, has := viewAs(ctx); has {
			t.Fatal("time_zone should not be returned after disabling")
		}
	}
}
