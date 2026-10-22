package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/static"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

type UserService struct{}

func NewUserService() *UserService {
	return &UserService{}
}

type oidcLoginState struct {
	Name         string
	RedirectBack string
	IsBind       bool
	Nonce        string // 与浏览器 Cookie 中的 nonce 对应，防止登录/绑定 CSRF
	UserID       uint   // 绑定操作的发起用户，回调时必须是同一用户
}

const (
	loginLimitWindow      = 15 * time.Minute
	loginIPLimit          = 30 // 同一 IP 在窗口内最多登录请求数
	loginAccountFailLimit = 10 // 同一账号在窗口内最多失败次数
	verifyEmailIPLimit    = 10 // 同一 IP 每小时最多发送验证码次数
)

func emailVerifyEnabled() bool {
	return utils.Env.GetAsBool(constant.EnvKeyEnableEmailVerify, true)
}

// UserLogin 用户登录
func (s *UserService) UserLogin(req *dto.UserLoginReq) (*dto.UserLoginResp, *errs.ServiceError) {
	// 防爆破：同一 IP 的登录请求和同一账号的失败次数都有上限
	if !utils.AllowRequest("login_ip:"+req.UserIP, loginIPLimit, loginLimitWindow) {
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	accountKey := "login_fail:" + strings.ToLower(req.Username)
	if utils.TooManyFailures(accountKey, loginAccountFailLimit) {
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	// 按照用户名或邮箱查找用户；用户不存在与密码错误返回相同错误，避免枚举用户
	user, err := repo.User.GetUserByUsernameOrEmail(req.Username)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if user == nil || err != nil || !utils.Password.VerifyPassword(req.Password, user.Password) {
		utils.RecordFailure(accountKey, loginLimitWindow)
		return nil, errs.NewBadRequest("invalid_credentials")
	}
	utils.ResetFailures(accountKey)
	// 签发双token并持久化会话状态
	sessionId := utils.Strings.GenerateRandomString(32)
	err = repo.Session.CreateSession(&model.Session{
		UserID:    user.ID,
		SessionID: sessionId,
		UserIP:    utils.NewIPRecord(req.UserIP),
	})
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	token, refreshToken, err := utils.Jwt.New2Tokens(user.ID, sessionId, req.RememberMe)

	if err != nil {
		logrus.Errorln("Failed to generate tokens:", err)
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	resp := &dto.UserLoginResp{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user.ToPrivateDto(),
	}
	return resp, nil
}

// UserRegister 注册新用户
func (s *UserService) UserRegister(req *dto.UserRegisterReq) (*dto.UserRegisterResp, *errs.ServiceError) {
	if !tools.GetAllowRegister() {
		return nil, errs.NewForbidden("register_disabled")
	}
	if !isValidPassword(req.Password) {
		return nil, errs.NewBadRequest("invalid_password_format")
	}
	// 开启邮箱验证时，注册必须验证邮箱所有权，防止抢注他人邮箱
	if emailVerifyEnabled() && !utils.VerifyEmailCode(req.Email, req.VerifyCode) {
		return nil, errs.NewUnauthorized("invalid_verify_code")
	}
	// 检查用户名或邮箱是否已存在
	usernameExist, err := repo.User.CheckUsernameExists(req.Username)
	if err != nil {
		return nil, errs.NewBadRequest("failed_to_check_target")
	}
	emailExist, err := repo.User.CheckEmailExists(req.Email)
	if err != nil {
		return nil, errs.NewBadRequest("failed_to_check_target")
	}
	if usernameExist || emailExist {
		return nil, errs.NewConflict("username_or_email_already_exists")
	}
	// 创建新用户
	hashedPassword, err := utils.Password.HashPassword(req.Password)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	newUser := &model.User{
		Username: req.Username,
		Nickname: req.Nickname,
		Email:    req.Email,
		Gender:   "unknown",
		Role:     "user",
		Password: hashedPassword,
	}
	err = repo.User.CreateUser(newUser)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	// 创建默认管理员账户
	if newUser.ID == 1 {
		newUser.Role = constant.RoleAdmin
		err = repo.User.UpdateUser(newUser)
		if err != nil {
			logrus.Errorln("Failed to update user role to admin:", err)
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
	}
	// 生成访问令牌和刷新令牌并保存session
	sessionId := utils.Strings.GenerateRandomString(32)
	err = repo.Session.CreateSession(&model.Session{
		UserID:    newUser.ID,
		SessionID: sessionId,
		UserIP:    utils.NewIPRecord(req.UserIP),
	})
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	token, refreshToken, err := utils.Jwt.New2Tokens(newUser.ID, sessionId, false)

	if err != nil {
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	resp := &dto.UserRegisterResp{
		Token:        token,
		RefreshToken: refreshToken,
		User:         newUser.ToPrivateDto(),
	}
	return resp, nil
}

func (s *UserService) RequestVerifyEmail(req *dto.VerifyEmailReq) (*dto.VerifyEmailResp, *errs.ServiceError) {
	if !emailVerifyEnabled() {
		return nil, errs.NewForbidden("email_verify_disabled")
	}
	// 同一邮箱按冷却时间限制发送频率，同一 IP 每小时最多发送若干次，防止邮件轰炸
	coolDown := time.Duration(tools.GetVerifyCodeCoolDown()) * time.Second
	if !utils.AllowRequest("verify_email:"+strings.ToLower(req.Email), 1, coolDown) {
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	if !utils.AllowRequest("verify_email_ip:"+req.UserIP, verifyEmailIPLimit, time.Hour) {
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	verifyCode := utils.RequestEmailVerify(req.Email)
	template, err := static.RenderTemplate("email/verification-code.tmpl", map[string]interface{}{
		"Title":      "NEO-BLOG",
		"Email":      req.Email,
		"VerifyCode": verifyCode,
		"Expire":     10,
		"Details":    "你正在验证电子邮件所有权",
	})
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_render_email")
	}
	if utils.IsDevMode {
		logrus.Debugf("%s's verification code is %s", req.Email, verifyCode)
	}
	err = utils.Email.SendEmail(utils.Email.GetEmailConfigFromEnv(), req.Email, "验证你的电子邮件 / Verify your email", template, true)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_send_email")
	}
	return &dto.VerifyEmailResp{Success: true}, nil
}

func (s *UserService) ListOidcConfigs(req *dto.ListOidcConfigReq) ([]dto.UserOidcConfigDto, *errs.ServiceError) {
	enabledOidcConfigs, err := repo.Oidc.ListOidcConfigs(true)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	var oidcConfigsDtos []dto.UserOidcConfigDto
	req.RedirectBack = normalizeOidcRedirectBack(req.RedirectBack)

	for _, oidcConfig := range enabledOidcConfigs {
		// 生成和储存state到kv
		state := utils.Strings.GenerateRandomString(32)
		kvStore := utils.KV.GetInstance()
		kvStore.Set("oidc_state:"+state, oidcLoginState{
			Name:         oidcConfig.Name,
			RedirectBack: req.RedirectBack,
			IsBind:       req.IsBind,
			Nonce:        req.BrowserNonce,
			UserID:       req.UserID,
		}, 5*time.Minute)
		var loginUrl string
		callbackUrl := fmt.Sprintf("%s%s%s/%s",
			tools.GetBaseUrl(),
			constant.ApiPrefix,
			constant.OidcUri,
			oidcConfig.Name,
		)
		// 兼容misskey特殊的oidc实现
		if oidcConfig.Type == "misskey" {
			// Misskey OIDC 特殊处理
			loginUrl = utils.Url.BuildUrl(oidcConfig.AuthorizationEndpoint+"/"+state, map[string]string{
				"name":       tools.GetSiteName(),
				"icon":       tools.GetSiteIcon(),
				"callback":   callbackUrl,
				"permission": "read:account",
			})
		} else {
			// 常规 OAuth2/OIDC 处理
			loginUrl = utils.Url.BuildUrl(oidcConfig.AuthorizationEndpoint, map[string]string{
				"client_id":     oidcConfig.ClientID,
				"redirect_uri":  callbackUrl,
				"response_type": "code",
				"scope":         "openid email profile",
				"state":         state,
			})
		}
		oidcConfigsDtos = append(oidcConfigsDtos, dto.UserOidcConfigDto{
			Name:        oidcConfig.Name,
			DisplayName: oidcConfig.DisplayName,
			Icon:        oidcConfig.Icon,
			LoginUrl:    loginUrl,
		})
	}
	return oidcConfigsDtos, nil
}

func normalizeOidcRedirectBack(redirectBack string) string {
	if redirectBack == "" ||
		!strings.HasPrefix(redirectBack, "/") ||
		strings.HasPrefix(redirectBack, "//") ||
		strings.ContainsAny(redirectBack, "\r\n") {
		return "/"
	}
	return redirectBack
}

// viewUserDto 本人或管理员查看时包含邮箱，其他人只能看到公开信息
func viewUserDto(ctx context.Context, user *model.User) dto.UserDto {
	if ctxutils.IsOwnerOfTarget(ctx, user.ID) || ctxutils.IsAdmin(ctx) {
		return user.ToPrivateDto()
	}
	return user.ToDto()
}

func (s *UserService) GetUser(ctx context.Context, req *dto.GetUserReq) (*dto.GetUserResp, *errs.ServiceError) {
	if req.UserID == 0 {
		return nil, errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	user, err := repo.User.GetUserByID(req.UserID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found")
		}
		logrus.Errorln("Failed to get user by ID:", err)
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if user == nil {
		return nil, errs.NewNotFound("target_not_found")
	}
	return &dto.GetUserResp{
		User: viewUserDto(ctx, user),
	}, nil
}

func (s *UserService) GetUserByUsername(ctx context.Context, req *dto.GetUserByUsernameReq) (*dto.GetUserResp, *errs.ServiceError) {
	if req.Username == "" {
		return nil, errs.NewBadRequest("username_cannot_be_empty")
	}
	user, err := repo.User.GetUserByUsername(req.Username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found")
		}
		logrus.Errorln("Failed to get user by username:", err)
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if user == nil {
		return nil, errs.NewNotFound("target_not_found")
	}
	return &dto.GetUserResp{
		User: viewUserDto(ctx, user),
	}, nil
}

func (s *UserService) UpdateUser(req *dto.UpdateUserReq) (*dto.UpdateUserResp, *errs.ServiceError) {
	user := &model.User{
		Model: gorm.Model{
			ID: req.ID,
		},
		Username:       req.Username,
		Nickname:       req.Nickname,
		Gender:         req.Gender,
		AvatarUrl:      req.AvatarUrl,
		BackgroundUrl:  req.BackgroundUrl,
		PreferredColor: req.PreferredColor,
		Language:       req.Language,
		ShowIPLocation: req.ShowIPLocation,
	}
	err := repo.User.UpdateUser(user)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found")
		}
		logrus.Errorln("Failed to update user:", err)
		return nil, errs.NewInternalServer("failed_to_update_target")
	}
	return &dto.UpdateUserResp{}, nil
}

func (s *UserService) UpdatePassword(ctx context.Context, req *dto.UpdatePasswordReq) (bool, *errs.ServiceError) {
	if !isValidPassword(req.NewPassword) {
		return false, errs.NewBadRequest("invalid_password_format")
	}

	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok || currentUser == nil {
		return false, errs.NewUnauthorized("login_required")
	}
	if !utils.Password.VerifyPassword(req.OldPassword, currentUser.Password) {
		return false, errs.NewBadRequest("old_password_incorrect")
	}
	hashedPassword, err := utils.Password.HashPassword(req.NewPassword)
	if err != nil {
		logrus.Errorln("Failed to update password:", err)
		return false, errs.NewInternalServer("failed_to_update_target")
	}
	currentUser.Password = hashedPassword
	err = repo.GetDB().Save(currentUser).Error
	if err != nil {
		return false, errs.NewInternalServer("failed_to_update_target")
	}
	// 改密后其他设备上的登录全部失效，只保留当前会话
	currentSessionID, _ := ctx.Value("session_id").(string)
	if err := repo.Session.RevokeUserSessions(currentUser.ID, currentSessionID); err != nil {
		logrus.Errorln("Failed to revoke sessions:", err)
	}
	return true, nil
}

func (s *UserService) ResetPassword(req *dto.ResetPasswordReq) (bool, *errs.ServiceError) {
	if !isValidPassword(req.NewPassword) {
		return false, errs.NewBadRequest("invalid_password_format")
	}
	// 查找用户
	user, err := repo.User.GetUserByEmail(req.Email)
	if err != nil {
		return false, errs.NewNotFound("user_not_found")
	}
	hashedPassword, err := utils.Password.HashPassword(req.NewPassword)
	if err != nil {
		return false, errs.NewInternalServer("failed_to_create_target")
	}
	user.Password = hashedPassword
	err = repo.User.UpdateUser(user)
	if err != nil {
		return false, errs.NewInternalServer("failed_to_update_target")
	}
	// 重置密码后吊销该用户的全部会话
	if err := repo.Session.RevokeUserSessions(user.ID, ""); err != nil {
		logrus.Errorln("Failed to revoke sessions:", err)
	}
	return true, nil
}

func (s *UserService) UpdateEmail(ctx context.Context, email string) (bool, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok || currentUser == nil {
		return false, errs.NewUnauthorized("login_required")
	}
	currentUser.Email = email
	err := repo.GetDB().Save(currentUser).Error
	if err != nil {
		return false, errs.NewInternalServer("failed_to_update_target")
	}
	return true, nil
}

func isValidPassword(password string) bool {
	if len(password) < 8 || len(password) > 32 {
		return false
	}
	return true
}
