package service

import (
	"net/http"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestUpdateUserGender(t *testing.T) {
	author, admin, _, _, _ := setupEditTest(t)
	authorID := mustUserID(t, author)
	svc := NewUserService()
	adminSvc := NewAdminUserService()
	ptr := func(s string) *string { return &s }
	stored := func() string {
		t.Helper()
		var u model.User
		if err := repo.GetDB().First(&u, authorID).Error; err != nil {
			t.Fatalf("load user: %v", err)
		}
		return u.Gender
	}

	// 用户自己修改：标准值、自定义文字去掉首尾空白、大小写不同按自定义文字保存、留空表示不填
	for _, c := range []struct{ in, want string }{
		{"male", "male"},
		{" female ", "female"},
		{"  猫娘  ", "猫娘"},
		{"Male", "Male"},
		{strings.Repeat("喵", genderMaxLen), strings.Repeat("喵", genderMaxLen)},
		{"", ""},
	} {
		if _, svcerr := svc.UpdateUser(&dto.UpdateUserReq{ID: authorID, Gender: ptr(c.in)}); svcerr != nil {
			t.Fatalf("update gender %q: %v", c.in, svcerr)
		}
		if got := stored(); got != c.want {
			t.Fatalf("gender %q saved as %q, want %q", c.in, got, c.want)
		}
	}

	// 超长或含控制字符的拒绝，原值不变
	if _, svcerr := svc.UpdateUser(&dto.UpdateUserReq{ID: authorID, Gender: ptr("female")}); svcerr != nil {
		t.Fatalf("update gender: %v", svcerr)
	}
	for _, in := range []string{strings.Repeat("喵", genderMaxLen+1), "猫\n娘", "a\tb"} {
		_, svcerr := svc.UpdateUser(&dto.UpdateUserReq{ID: authorID, Gender: ptr(in)})
		expectSvcErr(t, svcerr, http.StatusBadRequest, "invalid_gender")
	}
	if got := stored(); got != "female" {
		t.Fatalf("invalid gender should not be saved, got %q", got)
	}

	// 不带性别的更新（如只改主题色）不影响已填的性别
	if _, svcerr := svc.UpdateUser(&dto.UpdateUserReq{ID: authorID, PreferredColor: "blue"}); svcerr != nil {
		t.Fatalf("update color: %v", svcerr)
	}
	if got := stored(); got != "female" {
		t.Fatalf("gender should be kept, got %q", got)
	}

	// 管理员编辑用户：同样规整和校验，留空表示不填
	base := dto.AdminUpdateUserReq{ID: authorID, Username: "author", Email: "author@test.local"}
	req := base
	req.Gender = " 猫娘 "
	if svcerr := adminSvc.UpdateUser(admin, &req); svcerr != nil {
		t.Fatalf("admin update gender: %v", svcerr)
	}
	if got := stored(); got != "猫娘" {
		t.Fatalf("admin gender saved as %q, want 猫娘", got)
	}
	req = base
	req.Gender = strings.Repeat("喵", genderMaxLen+1)
	expectSvcErr(t, adminSvc.UpdateUser(admin, &req), http.StatusBadRequest, "invalid_gender")
	req = base
	if svcerr := adminSvc.UpdateUser(admin, &req); svcerr != nil {
		t.Fatalf("admin clear gender: %v", svcerr)
	}
	if got := stored(); got != "" {
		t.Fatalf("admin should clear gender, got %q", got)
	}

	// 新建的用户、AI 用户默认不填性别
	created, svcerr := adminSvc.CreateUser(admin, &dto.AdminCreateUserReq{Username: "newbie", Email: "newbie@test.local", Password: "password123", Role: constant.RoleUser})
	if svcerr != nil {
		t.Fatalf("create user: %v", svcerr)
	}
	if created.Gender != "" {
		t.Fatalf("new user gender = %q, want empty", created.Gender)
	}
	aiUser, svcerr := buildAIUser("bot", "", "")
	if svcerr != nil {
		t.Fatalf("build ai user: %v", svcerr)
	}
	if aiUser.Gender != "" {
		t.Fatalf("new ai user gender = %q, want empty", aiUser.Gender)
	}
}
