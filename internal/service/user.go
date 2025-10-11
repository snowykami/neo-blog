package service

import (
	"context"
	"errors"
	"fmt"
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

// UserLogin 用户登录
func (s *UserService) UserLogin(req *dto.UserLoginReq) (*dto.UserLoginResp, *errs.ServiceError) {
	// 按照用户名或邮箱查找用户
	user, err := repo.User.GetUserByUsernameOrEmail(req.Username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("user_not_found")
		}
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if user == nil {
		return nil, errs.NewNotFound("user_not_found")
	}
	// 验证密码
	if !utils.Password.VerifyPassword(req.Password, user.Password) {
		return nil, errs.NewBadRequest("invalid_credentials")
	}
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
		User:         user.ToDto(),
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
		User:         newUser.ToDto(),
	}
	return resp, nil
}

func (s *UserService) RequestVerifyEmail(req *dto.VerifyEmailReq) (*dto.VerifyEmailResp, *errs.ServiceError) {
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

func (s *UserService) ListOidcConfigs() ([]dto.UserOidcConfigDto, *errs.ServiceError) {
	enabledOidcConfigs, err := repo.Oidc.ListOidcConfigs(true)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	var oidcConfigsDtos []dto.UserOidcConfigDto

	for _, oidcConfig := range enabledOidcConfigs {
		// 生成和储存state到kv
		state := utils.Strings.GenerateRandomString(32)
		kvStore := utils.KV.GetInstance()
		kvStore.Set("oidc_state:"+state, oidcConfig.Name, 5*time.Minute)
		var loginUrl string
		// 兼容misskey特殊的oidc实现
		if oidcConfig.Type == "misskey" {
			// Misskey OIDC 特殊处理，草你妈日本人写的软件真的是猎奇
			loginUrl = utils.Url.BuildUrl(oidcConfig.AuthorizationEndpoint+"/"+state, map[string]string{
				"name": tools.GetSiteName(),
				"icon": tools.GetSiteIcon(),
				"callback": fmt.Sprintf("%s%s%s/%sREDIRECT_BACK", // 这个大占位符给前端替换用的，替换时也要uri编码因为是层层包的
					tools.GetBaseUrl(),
					constant.ApiPrefix,
					constant.OidcUri,
					oidcConfig.Name,
				),
				"permission": "read:account",
			})
		} else {
			// 常规 OAuth2/OIDC 处理
			loginUrl = utils.Url.BuildUrl(oidcConfig.AuthorizationEndpoint, map[string]string{
				"client_id": oidcConfig.ClientID,
				"redirect_uri": fmt.Sprintf("%s%s%s/%sREDIRECT_BACK", // 这个大占位符给前端替换用的，替换时也要uri编码因为是层层包的
					tools.GetBaseUrl(),
					constant.ApiPrefix,
					constant.OidcUri,
					oidcConfig.Name,
				),
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

func (s *UserService) GetUser(req *dto.GetUserReq) (*dto.GetUserResp, *errs.ServiceError) {
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
		User: user.ToDto(),
	}, nil
}

func (s *UserService) GetUserByUsername(req *dto.GetUserByUsernameReq) (*dto.GetUserResp, *errs.ServiceError) {
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
		User: user.ToDto(),
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
	}
	currentUser.Password = hashedPassword
	err = repo.GetDB().Save(currentUser).Error
	if err != nil {
		return false, errs.NewInternalServer("failed_to_update_target")
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
