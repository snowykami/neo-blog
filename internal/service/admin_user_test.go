package service

import (
	"context"
	"net/http"
	"testing"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
)

func expectSvcErr(t *testing.T, svcerr *errs.ServiceError, code int, msg string) {
	t.Helper()
	if svcerr == nil || svcerr.Code != code || svcerr.Message != msg {
		t.Fatalf("expected %d %s, got %+v", code, msg, svcerr)
	}
}

func mustUserID(t *testing.T, ctx context.Context) uint {
	t.Helper()
	id, ok := ctxutils.GetCurrentUserID(ctx)
	if !ok {
		t.Fatal("user not found in ctx")
	}
	return id
}

func TestAdminUserPermissionBoundaries(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	svc := NewAdminUserService()
	adminID := mustUserID(t, admin)
	otherID := mustUserID(t, other)

	// 非管理员不能调用任何管理接口
	if _, _, svcerr := svc.ListUsers(author, &dto.AdminListUsersReq{}); svcerr == nil {
		t.Fatal("editor should not list users")
	}
	expectSvcErr(t, svc.DeleteUser(author, otherID), http.StatusForbidden, "permission_denied")
	expectSvcErr(t, svc.UpdateUserRole(context.Background(), &dto.AdminUpdateUserRoleReq{ID: otherID, Role: constant.RoleAdmin}), http.StatusUnauthorized, "login_required")

	// 不能对自己执行删除、改角色、禁用
	expectSvcErr(t, svc.DeleteUser(admin, adminID), http.StatusForbidden, "cannot_operate_self")
	expectSvcErr(t, svc.UpdateUserRole(admin, &dto.AdminUpdateUserRoleReq{ID: adminID, Role: constant.RoleUser}), http.StatusForbidden, "cannot_operate_self")
	expectSvcErr(t, svc.UpdateUserStatus(admin, &dto.AdminUpdateUserStatusReq{ID: adminID, Disabled: true}), http.StatusForbidden, "cannot_operate_self")
	expectSvcErr(t, svc.UpdateUserRole(admin, &dto.AdminUpdateUserRoleReq{ID: otherID, Role: "root"}), http.StatusBadRequest, "invalid_role")
}

func TestAdminUserLastAdminProtected(t *testing.T) {
	_, admin, other, _, _ := setupEditTest(t)
	svc := NewAdminUserService()
	adminID := mustUserID(t, admin)
	otherID := mustUserID(t, other)

	// 提升 other 为管理员后，admin 降级 other 可行（自己仍是管理员）
	if svcerr := svc.UpdateUserRole(admin, &dto.AdminUpdateUserRoleReq{ID: otherID, Role: constant.RoleAdmin}); svcerr != nil {
		t.Fatalf("promote: %v", svcerr)
	}
	// 禁用 admin 本人（数据层面模拟）后，other 成为唯一启用的管理员，admin 视为未登录
	if err := repo.User.UpdateUserColumns(adminID, map[string]any{"disabled": true}); err != nil {
		t.Fatal(err)
	}
	if _, ok := ctxutils.GetCurrentUser(admin); ok {
		t.Fatal("disabled user should be treated as logged out")
	}
	if svcerr := svc.DeleteUser(admin, otherID); svcerr == nil {
		t.Fatal("disabled admin should not delete users")
	}
	// 直接校验最后一个管理员保护
	target, _ := repo.User.GetUserByID(otherID)
	expectSvcErr(t, ensureOtherActiveAdmin(target), http.StatusForbidden, "cannot_remove_last_admin")

	// 恢复 admin 后可以降级 other
	if err := repo.User.UpdateUserColumns(adminID, map[string]any{"disabled": false}); err != nil {
		t.Fatal(err)
	}
	if svcerr := svc.UpdateUserRole(other, &dto.AdminUpdateUserRoleReq{ID: adminID, Role: constant.RoleUser}); svcerr != nil {
		t.Fatalf("demote other admin: %v", svcerr)
	}
	// 现在 other 是唯一管理员，admin 已是普通用户，无权操作
	expectSvcErr(t, svc.UpdateUserRole(admin, &dto.AdminUpdateUserRoleReq{ID: otherID, Role: constant.RoleUser}), http.StatusForbidden, "permission_denied")
}

func TestAdminUserDisableBlocksLogin(t *testing.T) {
	_, admin, _, _, _ := setupEditTest(t)
	svc := NewAdminUserService()
	created, svcerr := svc.CreateUser(admin, &dto.AdminCreateUserReq{
		Username: "newbie", Email: "newbie@test.local", Password: "password123", Role: constant.RoleUser,
	})
	if svcerr != nil {
		t.Fatalf("create: %v", svcerr)
	}
	if _, svcerr := svc.CreateUser(admin, &dto.AdminCreateUserReq{
		Username: "newbie", Email: "x@test.local", Password: "password123",
	}); svcerr == nil {
		t.Fatal("duplicate username should fail")
	}
	login := func(password string) *errs.ServiceError {
		_, svcerr := NewUserService().UserLogin(&dto.UserLoginReq{Username: "newbie", Password: password, UserIP: "10.0.0.1"})
		return svcerr
	}
	if svcerr := login("password123"); svcerr != nil {
		t.Fatalf("login: %v", svcerr)
	}
	if svcerr := svc.UpdateUserStatus(admin, &dto.AdminUpdateUserStatusReq{ID: created.ID, Disabled: true}); svcerr != nil {
		t.Fatalf("disable: %v", svcerr)
	}
	expectSvcErr(t, login("password123"), http.StatusForbidden, "user_disabled")
	var sessions int64
	repo.GetDB().Model(&model.Session{}).Where("user_id = ?", created.ID).Count(&sessions)
	if sessions != 0 {
		t.Fatalf("sessions should be revoked, got %d", sessions)
	}

	// 重新启用并重置密码后用新密码登录
	if svcerr := svc.UpdateUserStatus(admin, &dto.AdminUpdateUserStatusReq{ID: created.ID, Disabled: false}); svcerr != nil {
		t.Fatalf("enable: %v", svcerr)
	}
	if svcerr := svc.ResetUserPassword(admin, &dto.AdminResetUserPasswordReq{ID: created.ID, NewPassword: "newpassword"}); svcerr != nil {
		t.Fatalf("reset: %v", svcerr)
	}
	expectSvcErr(t, login("password123"), http.StatusBadRequest, "invalid_credentials")
	if svcerr := login("newpassword"); svcerr != nil {
		t.Fatalf("login with new password: %v", svcerr)
	}

	// 筛选
	users, total, svcerr := svc.ListUsers(admin, &dto.AdminListUsersReq{
		PaginationParams: dto.PaginationParams{Page: 1, Size: 10},
		Keyword:          "newb",
		Status:           constant.UserStatusActive,
	})
	if svcerr != nil || total != 1 || users[0].Username != "newbie" {
		t.Fatalf("filter: %v %d", svcerr, total)
	}
}

func TestAdminUserUpdateAndDelete(t *testing.T) {
	author, admin, other, post, _ := setupEditTest(t)
	svc := NewAdminUserService()
	adminID := mustUserID(t, admin)
	authorID := mustUserID(t, author)
	otherID := mustUserID(t, other)

	// 邮箱冲突
	expectSvcErr(t, svc.UpdateUser(admin, &dto.AdminUpdateUserReq{ID: authorID, Username: "author", Email: "other@test.local"}), http.StatusConflict, "username_or_email_already_exists")
	if svcerr := svc.UpdateUser(admin, &dto.AdminUpdateUserReq{ID: authorID, Username: "writer", Nickname: "", Email: "writer@test.local"}); svcerr != nil {
		t.Fatalf("update: %v", svcerr)
	}

	// author 的评论下有 admin 的回复（文章为私密，other 不可见），删除 author 后整棵回复树一起删除，文章转给管理员
	rootID, svcerr := NewCommentService().CreateComment(author, &dto.CreateCommentReq{TargetID: post.ID, TargetType: constant.TargetTypePost, Content: "root"})
	if svcerr != nil {
		t.Fatalf("comment: %v", svcerr)
	}
	if _, svcerr := NewCommentService().CreateComment(admin, &dto.CreateCommentReq{TargetID: post.ID, TargetType: constant.TargetTypePost, Content: "reply", ReplyID: rootID}); svcerr != nil {
		t.Fatalf("reply: %v", svcerr)
	}
	keepID, svcerr := NewCommentService().CreateComment(admin, &dto.CreateCommentReq{TargetID: post.ID, TargetType: constant.TargetTypePost, Content: "keep"})
	if svcerr != nil {
		t.Fatalf("comment: %v", svcerr)
	}
	detail, svcerr := svc.GetUserDetail(admin, authorID)
	if svcerr != nil || detail.PostCount != 1 || detail.CommentCount != 1 {
		t.Fatalf("detail: %+v %v", detail, svcerr)
	}

	if svcerr := svc.DeleteUser(admin, authorID); svcerr != nil {
		t.Fatalf("delete: %v", svcerr)
	}
	var count int64
	repo.GetDB().Unscoped().Model(&model.User{}).Where("id = ?", authorID).Count(&count)
	if count != 0 {
		t.Fatal("user should be hard deleted")
	}
	reloaded := reloadPost(t, post.ID)
	if reloaded.UserID != adminID {
		t.Fatalf("post should be transferred to admin, got %d", reloaded.UserID)
	}
	if reloaded.CommentCount != 1 {
		t.Fatalf("comment count should be 1, got %d", reloaded.CommentCount)
	}
	if _, err := repo.Comment.GetComment(keepID); err != nil {
		t.Fatalf("unrelated comment should be kept: %v", err)
	}
	if _, err := repo.User.GetUserByID(otherID); err != nil {
		t.Fatalf("other user should be kept: %v", err)
	}
}
