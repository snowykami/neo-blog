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
		return nil, errs.NewForbidden("registration_disabled")
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

// OidcLogin 此函数用于oidc provider响应给前端的重定向
func (s *UserService) OidcLogin(ctx context.Context, req *dto.OidcLoginReq) (*dto.OidcLoginResp, *errs.ServiceError) {
	// 验证state
	kvStore := utils.KV.GetInstance()
	storedName, ok := kvStore.Get("oidc_state:" + req.State) // state: oidc_name
	if !ok || storedName != req.Name {
		// 尝试使用session作为state验证（Misskey特例）
		if req.Session != "" {
			// Misskey的state是session，直接用session作为state验证
			storedName, ok = kvStore.Get("oidc_state:" + req.Session)
			if !ok || storedName != req.Name {
				return nil, errs.NewBadRequest("invalid_oidc_state")
			}
		}
	}
	// 获取OIDC配置
	oidcConfig, err := repo.Oidc.GetOidcConfigByName(req.Name)
	if err != nil || oidcConfig == nil {
		return nil, errs.NewBadRequest("invalid_oidc_name")
	}
	// 预制变量userinfo
	userInfo := &utils.Userinfo{}
	// 请求访问令牌和用户信息
	if oidcConfig.Type == "misskey" {
		// 处理 Misskey 特例
		misskeyTokenResp, err := utils.Oidc.RequestMisskeyToken(oidcConfig.TokenEndpoint, req.Session)
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_request_oidc_token")
		}
		userInfo.Sub = misskeyTokenResp.User.ID
		userInfo.Name = misskeyTokenResp.User.Name
		userInfo.PreferredUsername = misskeyTokenResp.User.Username
		userInfo.Email = misskeyTokenResp.User.Email
		userInfo.Picture = misskeyTokenResp.User.AvatarUrl
	} else {
		// 处理标准 OIDC/OAuth2和GitHub特例
		// 请求访问令牌
		tokenResp, err := utils.Oidc.RequestToken(
			oidcConfig.TokenEndpoint,
			oidcConfig.ClientID,
			oidcConfig.ClientSecret,
			req.Code,
			tools.GetBaseUrl()+constant.ApiPrefix+constant.OidcUri+"/"+oidcConfig.Name,
		)
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_request_oidc_token")
		}
		// 请求用户信息
		userInfo, err = utils.Oidc.RequestUserinfo(oidcConfig.UserinfoEndpoint, tokenResp.AccessToken)
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_request_oidc_userinfo")
		}
		// GitHub 特例处理 PreferredUsername、Sub、Name、Picture和Email
		if strings.Contains(oidcConfig.TokenEndpoint, "https://github.com") {
			// 没有 sub 时用不可变 id 做 sub（加 provider 前缀），并尝试获取优先邮箱
			// 用 provider 前缀 + immutable id 作为 sub，避免后续冲突
			userInfo.Picture = userInfo.AvatarUrl
			userInfo.PreferredUsername = userInfo.Login
			if userInfo.Sub == "" && userInfo.ID != 0 {
				userInfo.Sub = fmt.Sprintf("github:%d", userInfo.ID)
			}
			emails, err := utils.Oidc.RequestGitHubUserVerifiedEmails(tokenResp.AccessToken)
			if err != nil {
				return nil, errs.NewInternalServer("failed_to_request_oidc_userinfo")
			} else if len(emails) > 0 {
				// 遍历邮箱，在数据库中找已存在的邮箱，找到直接赋值，找不到则使用第一个
				emailFound := false
				for _, email := range emails {
					exists, err := repo.User.CheckEmailExists(email)
					if err != nil {
						return nil, errs.NewInternalServer("failed_to_check_target")
					}
					if exists {
						userInfo.Email = email
						emailFound = true
						break
					}
				}
				if !emailFound && len(emails) > 0 {
					userInfo.Email = emails[0]
				}
			}
		}
	}

	// 这里不能用username来拼接兜底邮箱，不然可能有用户在第三方注册了和本站邮箱相同的用户名，导致邮箱冲突或者伪造，生成随机邮箱
	if userInfo.Email == "" {
		userInfo.Email = fmt.Sprintf("%s@replace-to-your-email", utils.Strings.GenerateRandomString(10))
	}

	// 完成fallback赋值后最终检查必要字段
	if userInfo.Sub == "" {
		return nil, errs.NewInternalServer("missing_required_oidc_field_sub")
	}
	if userInfo.Email == "" {
		return nil, errs.NewInternalServer("missing_required_oidc_field_email")
	}
	if userInfo.PreferredUsername == "" {
		return nil, errs.NewInternalServer("missing_required_oidc_field_preferred_username")
	}

	if req.IsBind {
		currentUser, userOk := ctxutils.GetCurrentUser(ctx)
		if currentUser == nil || !userOk {
			return nil, errs.NewUnauthorized("login_required")
		}
		// 检查该第三方账号是否已被绑定
		existingUserOpenID, err := repo.User.GetUserOpenIDByIssuerAndSub(oidcConfig.Issuer, userInfo.Sub)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			// 非找不到记录的其他错误
			logrus.Errorln("Failed to get user OpenID:", err)
			return nil, errs.NewInternalServer("failed_to_get_user_openid")
		}
		if existingUserOpenID != nil {
			// 已被绑定则直接登录新用户
			token, refreshToken, err := utils.Jwt.New2Tokens(currentUser.ID, "", false)
			if err != nil {
				return nil, errs.NewInternalServer("failed_to_create_target")
			}
			return &dto.OidcLoginResp{
				Token:        token,
				RefreshToken: refreshToken,
				User:         currentUser.ToDto(),
			}, nil
		}
		// 绑定当前登录用户和第三方账号
		userOpenID := &model.UserOpenID{
			UserID: currentUser.ID,
			Issuer: oidcConfig.Issuer,
			Sub:    userInfo.Sub,
		}

		if err = repo.User.CreateOrUpdateUserOpenID(userOpenID); err != nil {
			return nil, errs.NewConflict("failed_to_link_oidc_account")
		}
		// 绑定模式不生成新的token
		return &dto.OidcLoginResp{
			Token:        "",
			RefreshToken: "",
			User:         currentUser.ToDto(),
		}, nil
	}

	// 预生成sessionId
	sessionId := utils.Strings.GenerateRandomString(32)
	userOpenID, err := repo.User.GetUserOpenIDByIssuerAndSub(oidcConfig.Issuer, userInfo.Sub)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		// 非找不到记录的其他错误
		return nil, errs.NewInternalServer("failed_to_get_user_openid")
	}

	// 1. 曾经绑定过登录
	if userOpenID != nil {
		user, err := repo.User.GetUserByID(userOpenID.UserID)
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_get_user")
		}
		if err = repo.Session.CreateSession(&model.Session{
			UserID:    user.ID,
			SessionID: sessionId,
			UserIP:    utils.NewIPRecord(req.UserIP),
		}); err != nil {
			return nil, errs.NewInternalServer("failed_to_create_target")
		}
		token, refreshToken, err := utils.Jwt.New2Tokens(user.ID, sessionId, false)
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_create_target")
		}
		resp := &dto.OidcLoginResp{
			Token:        token,
			RefreshToken: refreshToken,
			User:         user.ToDto(),
		}
		return resp, nil
	}

	// 2. 曾经未绑定过登录，使用第三方提供的邮箱查询本地是否存在，存在继续绑定登录，不存在创建新用户
	localUser, err := repo.User.GetUserByEmail(userInfo.Email)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.NewInternalServer("failed_to_get_user")
	}
	if localUser != nil {
		// 存在则绑定并签发token
		userOpenID = &model.UserOpenID{
			UserID: localUser.ID,
			Issuer: oidcConfig.Issuer,
			Sub:    userInfo.Sub,
		}
		if err = repo.User.CreateOrUpdateUserOpenID(userOpenID); err != nil {
			return nil, errs.NewConflict("failed_to_link_oidc_account")
		}
		if err = repo.Session.CreateSession(&model.Session{
			UserID:    localUser.ID,
			SessionID: sessionId,
			UserIP:    utils.NewIPRecord(req.UserIP),
		}); err != nil {
			return nil, errs.NewInternalServer("failed_to_create_target")
		}
		token, refreshToken, err := utils.Jwt.New2Tokens(localUser.ID, sessionId, false)
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_generate_tokens")
		}
		resp := &dto.OidcLoginResp{
			Token:        token,
			RefreshToken: refreshToken,
			User:         localUser.ToDto(),
		}
		return resp, nil
	}
	// 3. 第一次登录，创建新用户并登录
	if !tools.GetAllowRegisterFromOidc() {
		return nil, errs.NewForbidden("register_from_oidc_disabled")
	}
	// 检测用户名是否重复
	usernameExists, err := repo.User.CheckUsernameExists(userInfo.PreferredUsername)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_check_target")
	}
	// 如果用户名已存在，尝试添加随机后缀
	if usernameExists {
		for i := 0; i < 10; i++ { // 最多尝试10次
			randomSuffix := utils.Strings.GenerateRandomString(6)
			newUsername := userInfo.PreferredUsername + "_" + randomSuffix
			exists, err := repo.User.CheckUsernameExists(newUsername)
			if err != nil {
				return nil, errs.NewInternalServer("failed_to_check_target")
			}
			if !exists {
				userInfo.PreferredUsername = newUsername
				logrus.Infof("Username conflict resolved: %s -> %s", userInfo.PreferredUsername, newUsername)
				break
			}
		}
	}

	newUser := &model.User{
		Username:  userInfo.PreferredUsername,
		Nickname:  userInfo.Name,
		AvatarUrl: userInfo.Picture,
		Email:     userInfo.Email,
		Role:      constant.RoleUser,
	}

	if err = repo.User.CreateUser(newUser); err != nil {
		return nil, errs.NewInternalServer("failed_to_create_user")
	}
	// 创建管理员
	if newUser.ID == 1 {
		newUser.Role = constant.RoleAdmin
		if err = repo.User.UpdateUser(newUser); err != nil {
			logrus.Errorln("Failed to update user role to admin:", err)
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
	}
	userOpenID = &model.UserOpenID{
		UserID: newUser.ID,
		Issuer: oidcConfig.Issuer,
		Sub:    userInfo.Sub,
	}
	if err = repo.User.CreateOrUpdateUserOpenID(userOpenID); err != nil {
		return nil, errs.NewConflict("failed_to_link_oidc_account")
	}
	if err = repo.Session.CreateSession(&model.Session{
		UserID:    newUser.ID,
		SessionID: sessionId,
		UserIP:    utils.NewIPRecord(req.UserIP),
	}); err != nil {
		return nil, errs.NewInternalServer("failed_to_create_target")
	}
	token, refreshToken, err := utils.Jwt.New2Tokens(newUser.ID, sessionId, false)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_generate_tokens")
	}
	resp := &dto.OidcLoginResp{
		Token:        token,
		RefreshToken: refreshToken,
		User:         newUser.ToDto(),
	}
	return resp, nil
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
