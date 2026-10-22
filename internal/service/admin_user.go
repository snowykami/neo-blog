package service

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"unicode/utf8"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

const (
	usernameMaxLen = 20
	nicknameMaxLen = 20
)

// AdminUserService 管理员用户管理，路由层已限制仅管理员可访问，这里仍逐一校验，防止被其他入口复用时越权
type AdminUserService struct{}

func NewAdminUserService() *AdminUserService {
	return &AdminUserService{}
}

func isValidRole(role constant.Role) bool {
	return role == constant.RoleAdmin || role == constant.RoleEditor || role == constant.RoleUser
}

func isValidEmail(email string) bool {
	addr, err := mail.ParseAddress(email)
	return err == nil && addr.Address == email
}

func isValidUsername(username string) bool {
	n := utf8.RuneCountInString(username)
	return n > 0 && n <= usernameMaxLen && !strings.ContainsAny(username, " \t\r\n/@")
}

// requireAdmin 返回当前管理员
func requireAdmin(ctx context.Context) (*model.User, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok || currentUser == nil {
		return nil, errs.NewUnauthorized("login_required")
	}
	if !currentUser.IsAdmin() {
		return nil, errs.NewForbidden("permission_denied")
	}
	return currentUser, nil
}

// getManagedUser 校验操作者为管理员并取出目标用户；forbidSelf 为 true 时禁止对自己操作（删除、改角色、禁用）
func getManagedUser(ctx context.Context, userID uint, forbidSelf bool) (*model.User, *model.User, *errs.ServiceError) {
	operator, svcerr := requireAdmin(ctx)
	if svcerr != nil {
		return nil, nil, svcerr
	}
	if userID == 0 {
		return nil, nil, errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	if forbidSelf && operator.ID == userID {
		return nil, nil, errs.NewForbidden("cannot_operate_self")
	}
	target, err := repo.User.GetUserByID(userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, errs.NewNotFound("user_not_found")
		}
		logrus.Errorln("Failed to get user by ID:", err)
		return nil, nil, errs.NewInternalServer("failed_to_get_target")
	}
	return operator, target, nil
}

// ensureOtherActiveAdmin 目标是启用中的管理员时，确保系统里还有其他启用中的管理员
func ensureOtherActiveAdmin(target *model.User) *errs.ServiceError {
	if !target.IsAdmin() || target.Disabled {
		return nil
	}
	count, err := repo.User.CountActiveAdmins(target.ID)
	if err != nil {
		return errs.NewInternalServer("failed_to_check_target")
	}
	if count == 0 {
		return errs.NewForbidden("cannot_remove_last_admin")
	}
	return nil
}

// checkUsernameEmailFree 检查用户名、邮箱未被除 selfID 以外的用户占用
func checkUsernameEmailFree(username, email string, selfID uint) *errs.ServiceError {
	if u, err := repo.User.GetUserByUsername(username); err == nil && u.ID != selfID {
		return errs.NewConflict("username_or_email_already_exists")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return errs.NewInternalServer("failed_to_check_target")
	}
	if u, err := repo.User.GetUserByEmail(email); err == nil && u.ID != selfID {
		return errs.NewConflict("username_or_email_already_exists")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return errs.NewInternalServer("failed_to_check_target")
	}
	return nil
}

func (s *AdminUserService) ListUsers(ctx context.Context, req *dto.AdminListUsersReq) ([]dto.UserDto, uint64, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, 0, svcerr
	}
	if !(req.Role == "" || isValidRole(constant.Role(req.Role))) {
		return nil, 0, errs.NewBadRequest("invalid_role")
	}
	users, total, err := repo.User.ListUsers(req)
	if err != nil {
		logrus.Errorln("Failed to list users:", err)
		return nil, 0, errs.NewInternalServer("failed_to_get_target")
	}
	return model.ToUserDtos(users), total, nil
}

func (s *AdminUserService) GetUserDetail(ctx context.Context, userID uint) (*dto.AdminUserDetailResp, *errs.ServiceError) {
	_, target, svcerr := getManagedUser(ctx, userID, false)
	if svcerr != nil {
		return nil, svcerr
	}
	posts, pages, comments, err := repo.User.CountUserContent(target.ID)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	return &dto.AdminUserDetailResp{
		User:         target.ToPrivateDto(),
		PostCount:    posts,
		PageCount:    pages,
		CommentCount: comments,
	}, nil
}

func (s *AdminUserService) CreateUser(ctx context.Context, req *dto.AdminCreateUserReq) (*dto.UserDto, *errs.ServiceError) {
	if _, svcerr := requireAdmin(ctx); svcerr != nil {
		return nil, svcerr
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Nickname = strings.TrimSpace(req.Nickname)
	req.Email = strings.TrimSpace(req.Email)
	if req.Role == "" {
		req.Role = constant.RoleUser
	}
	if !isValidUsername(req.Username) {
		return nil, errs.NewBadRequest("invalid_username")
	}
	if utf8.RuneCountInString(req.Nickname) > nicknameMaxLen {
		return nil, errs.NewBadRequest("invalid_nickname")
	}
	if !isValidEmail(req.Email) {
		return nil, errs.NewBadRequest("invalid_email")
	}
	if !isValidRole(req.Role) {
		return nil, errs.NewBadRequest("invalid_role")
	}
	if !isValidPassword(req.Password) {
		return nil, errs.NewBadRequest("invalid_password_format")
	}
	if svcerr := checkUsernameEmailFree(req.Username, req.Email, 0); svcerr != nil {
		return nil, svcerr
	}
	hashedPassword, err := utils.Password.HashPassword(req.Password)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	nickname := req.Nickname
	if nickname == "" {
		nickname = req.Username
	}
	newUser := &model.User{
		Username: req.Username,
		Nickname: nickname,
		Email:    req.Email,
		Gender:   "unknown",
		Role:     req.Role,
		Password: hashedPassword,
	}
	if err := repo.User.CreateUser(newUser); err != nil {
		logrus.Errorln("Failed to create user:", err)
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	userDto := newUser.ToPrivateDto()
	return &userDto, nil
}

func (s *AdminUserService) UpdateUser(ctx context.Context, req *dto.AdminUpdateUserReq) *errs.ServiceError {
	_, target, svcerr := getManagedUser(ctx, req.ID, false)
	if svcerr != nil {
		return svcerr
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Nickname = strings.TrimSpace(req.Nickname)
	req.Email = strings.TrimSpace(req.Email)
	req.AvatarUrl = strings.TrimSpace(req.AvatarUrl)
	req.BackgroundUrl = strings.TrimSpace(req.BackgroundUrl)
	if !isValidUsername(req.Username) {
		return errs.NewBadRequest("invalid_username")
	}
	if utf8.RuneCountInString(req.Nickname) > nicknameMaxLen {
		return errs.NewBadRequest("invalid_nickname")
	}
	if !isValidEmail(req.Email) {
		return errs.NewBadRequest("invalid_email")
	}
	if !(req.AvatarUrl == "" || utils.Url.IsValidUrl(req.AvatarUrl)) {
		return errs.NewBadRequest("invalid_url")
	}
	if !(req.BackgroundUrl == "" || utils.Url.IsValidUrl(req.BackgroundUrl)) {
		return errs.NewBadRequest("invalid_url")
	}
	if svcerr := checkUsernameEmailFree(req.Username, req.Email, target.ID); svcerr != nil {
		return svcerr
	}
	err := repo.User.UpdateUserColumns(target.ID, map[string]any{
		"username":       req.Username,
		"nickname":       req.Nickname,
		"email":          req.Email,
		"avatar_url":     req.AvatarUrl,
		"background_url": req.BackgroundUrl,
		"gender":         req.Gender,
	})
	if err != nil {
		logrus.Errorln("Failed to update user:", err)
		return errs.NewInternalServer("failed_to_update_target")
	}
	return nil
}

func (s *AdminUserService) UpdateUserRole(ctx context.Context, req *dto.AdminUpdateUserRoleReq) *errs.ServiceError {
	if !isValidRole(req.Role) {
		return errs.NewBadRequest("invalid_role")
	}
	_, target, svcerr := getManagedUser(ctx, req.ID, true)
	if svcerr != nil {
		return svcerr
	}
	if target.Role == req.Role {
		return nil
	}
	if svcerr := ensureOtherActiveAdmin(target); svcerr != nil {
		return svcerr
	}
	if err := repo.User.UpdateUserColumns(target.ID, map[string]any{"role": req.Role}); err != nil {
		return errs.NewInternalServer("failed_to_update_target")
	}
	return nil
}

func (s *AdminUserService) UpdateUserStatus(ctx context.Context, req *dto.AdminUpdateUserStatusReq) *errs.ServiceError {
	_, target, svcerr := getManagedUser(ctx, req.ID, true)
	if svcerr != nil {
		return svcerr
	}
	if target.Disabled == req.Disabled {
		return nil
	}
	if req.Disabled {
		if svcerr := ensureOtherActiveAdmin(target); svcerr != nil {
			return svcerr
		}
	}
	if err := repo.User.UpdateUserColumns(target.ID, map[string]any{"disabled": req.Disabled}); err != nil {
		return errs.NewInternalServer("failed_to_update_target")
	}
	// 禁用后吊销全部会话，refresh token 立即失效
	if req.Disabled {
		if err := repo.Session.RevokeUserSessions(target.ID, ""); err != nil {
			logrus.Errorln("Failed to revoke sessions:", err)
		}
	}
	return nil
}

func (s *AdminUserService) ResetUserPassword(ctx context.Context, req *dto.AdminResetUserPasswordReq) *errs.ServiceError {
	if !isValidPassword(req.NewPassword) {
		return errs.NewBadRequest("invalid_password_format")
	}
	_, target, svcerr := getManagedUser(ctx, req.ID, false)
	if svcerr != nil {
		return svcerr
	}
	hashedPassword, err := utils.Password.HashPassword(req.NewPassword)
	if err != nil {
		return errs.NewInternalServer("failed_to_update_target")
	}
	if err := repo.User.UpdateUserColumns(target.ID, map[string]any{"password": hashedPassword}); err != nil {
		return errs.NewInternalServer("failed_to_update_target")
	}
	// 重置密码后该用户所有设备需重新登录；管理员重置自己的密码时保留当前会话
	currentSessionID := ""
	if ctxutils.IsOwnerOfTarget(ctx, target.ID) {
		currentSessionID, _ = ctx.Value("session_id").(string)
	}
	if err := repo.Session.RevokeUserSessions(target.ID, currentSessionID); err != nil {
		logrus.Errorln("Failed to revoke sessions:", err)
	}
	return nil
}

// DeleteUser 删除用户，其文章、页面、文件转交给执行删除的管理员，评论与点赞随用户删除
func (s *AdminUserService) DeleteUser(ctx context.Context, userID uint) *errs.ServiceError {
	operator, target, svcerr := getManagedUser(ctx, userID, true)
	if svcerr != nil {
		return svcerr
	}
	if svcerr := ensureOtherActiveAdmin(target); svcerr != nil {
		return svcerr
	}
	if err := repo.User.DeleteUser(target.ID, operator.ID); err != nil {
		logrus.Errorln("Failed to delete user:", err)
		return errs.NewInternalServer("failed_to_delete_target")
	}
	return nil
}
