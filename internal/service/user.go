package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
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
func (s *UserService) UserLogin(req *dto.UserLoginReq) (*dto.UserLoginResp, error) {
	// 按照用户名或邮箱查找用户
	user, err := repo.User.GetUserByUsernameOrEmail(req.Username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.ErrNotFound
		}
		return nil, errs.ErrInternalServer
	}
	if user == nil {
		return nil, errs.ErrNotFound
	}
	// 验证密码
	if !utils.Password.VerifyPassword(req.Password, user.Password) {
		return nil, errs.New(http.StatusUnauthorized, "Invalid username or password", nil)
	}
	// 签发双token并持久化会话状态
	sessionId := utils.Strings.GenerateRandomString(32)

	err = repo.Session.CreateSession(&model.Session{
		UserID:    user.ID,
		SessionID: sessionId,
		UserIP:    utils.NewIPRecord(req.UserIP),
	})
	if err != nil {
		return nil, errs.New(http.StatusInternalServerError, "Failed to create session", err)
	}
	token, refreshToken, err := utils.Jwt.New2Tokens(user.ID, sessionId, req.RememberMe)

	if err != nil {
		logrus.Errorln("Failed to generate tokens:", err)
		return nil, errs.ErrInternalServer
	}
	resp := &dto.UserLoginResp{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user.ToDto(),
	}
	return resp, nil
}

// UserRegister 注册新用户
func (s *UserService) UserRegister(req *dto.UserRegisterReq) (*dto.UserRegisterResp, error) {
	if !tools.GetAllowRegister() {
		return nil, errs.New(http.StatusForbidden, "Registration is disabled", nil)
	}
	// 检查用户名或邮箱是否已存在
	usernameExist, err := repo.User.CheckUsernameExists(req.Username)
	if err != nil {
		return nil, errs.ErrInternalServer
	}
	emailExist, err := repo.User.CheckEmailExists(req.Email)
	if err != nil {
		return nil, errs.ErrInternalServer
	}
	if usernameExist || emailExist {
		return nil, errs.New(http.StatusConflict, "Username or email already exists", nil)
	}
	// 创建新用户
	hashedPassword, err := utils.Password.HashPassword(req.Password)
	if err != nil {
		return nil, errs.ErrInternalServer
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
		return nil, errs.ErrInternalServer
	}
	// 创建默认管理员账户
	if newUser.ID == 1 {
		newUser.Role = constant.RoleAdmin
		err = repo.User.UpdateUser(newUser)
		if err != nil {
			logrus.Errorln("Failed to update user role to admin:", err)
			return nil, errs.ErrInternalServer
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
		return nil, errs.New(http.StatusInternalServerError, "Failed to create session", nil)
	}
	token, refreshToken, err := utils.Jwt.New2Tokens(newUser.ID, sessionId, false)

	if err != nil {
		logrus.Errorln("Failed to generate tokens:", err)
		return nil, errs.ErrInternalServer
	}
	resp := &dto.UserRegisterResp{
		Token:        token,
		RefreshToken: refreshToken,
		User:         newUser.ToDto(),
	}
	return resp, nil
}

func (s *UserService) RequestVerifyEmail(req *dto.VerifyEmailReq) (*dto.VerifyEmailResp, error) {
	verifyCode := utils.RequestEmailVerify(req.Email)
	template, err := static.RenderTemplate("email/verification-code.tmpl", map[string]interface{}{
		"Title":      "NEO-BLOG",
		"Email":      req.Email,
		"VerifyCode": verifyCode,
		"Expire":     10,
		"Details":    "你正在验证电子邮件所有权",
	})
	if err != nil {
		return nil, errs.ErrInternalServer
	}
	if utils.IsDevMode {
		logrus.Infof("%s's verification code is %s", req.Email, verifyCode)
	}
	err = utils.Email.SendEmail(utils.Email.GetEmailConfigFromEnv(), req.Email, "验证你的电子邮件 / Verify your email", template, true)
	if err != nil {
		return nil, errs.ErrInternalServer
	}
	return &dto.VerifyEmailResp{Success: true}, nil
}

func (s *UserService) ListOidcConfigs() ([]dto.UserOidcConfigDto, error) {
	enabledOidcConfigs, err := repo.Oidc.ListOidcConfigs(true)
	if err != nil {
		return nil, errs.ErrInternalServer
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
			loginUrl = utils.Url.BuildUrl(oidcConfig.AuthorizationEndpoint, map[string]string{
				"client_id": oidcConfig.ClientID,
				"redirect_uri": fmt.Sprintf("%s%s%s/%sREDIRECT_BACK", // 这个大占位符给前端替换用的，替换时也要uri编码因为是层层包的
					strings.TrimSuffix(utils.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl), "/"),
					constant.ApiPrefix,
					constant.OidcUri,
					oidcConfig.Name,
				),
				"response_type": "code",
				"scope":         "read:account",
				"state":         state,
			})
		} else {
			// 常规 OAuth2/OIDC 处理
			loginUrl = utils.Url.BuildUrl(oidcConfig.AuthorizationEndpoint, map[string]string{
				"client_id": oidcConfig.ClientID,
				"redirect_uri": fmt.Sprintf("%s%s%s/%sREDIRECT_BACK",
					strings.TrimSuffix(utils.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl), "/"),
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
func (s *UserService) OidcLogin(ctx context.Context, req *dto.OidcLoginReq) (*dto.OidcLoginResp, error) {
	// 验证state
	kvStore := utils.KV.GetInstance()
	storedName, ok := kvStore.Get("oidc_state:" + req.State) // state: oidc_name
	if !ok || storedName != req.Name {
		return nil, errs.New(http.StatusForbidden, "invalid oidc state", nil)
	}
	// 获取OIDC配置
	oidcConfig, err := repo.Oidc.GetOidcConfigByName(req.Name)
	if err != nil || oidcConfig == nil {
		return nil, errs.New(http.StatusNotFound, "OIDC configuration not found or error", nil)
	}
	// 请求访问令牌
	tokenResp, err := utils.Oidc.RequestToken(
		oidcConfig.TokenEndpoint,
		oidcConfig.ClientID,
		oidcConfig.ClientSecret,
		req.Code,
		tools.GetBaseUrl()+constant.ApiPrefix+constant.OidcUri+"/"+oidcConfig.Name,
	)
	if err != nil {
		return nil, errs.New(http.StatusInternalServerError, "Failed to request OIDC AccessToken", nil)
	}
	// 请求用户信息
	userInfo, err := utils.Oidc.RequestUserinfo(oidcConfig.UserinfoEndpoint, tokenResp.AccessToken)
	if err != nil {
		return nil, errs.New(http.StatusInternalServerError, "Failed to request OIDC Userinfo", nil)
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
			return nil, errs.New(http.StatusInternalServerError, "Failed to request GitHub user emails", err)
		} else if len(emails) > 0 {
			// 遍历邮箱，在数据库中找已存在的邮箱，找到直接赋值，找不到则使用第一个
			emailFound := false
			for _, email := range emails {
				exists, err := repo.User.CheckEmailExists(email)
				if err != nil {
					return nil, errs.New(http.StatusInternalServerError, "Error to check email existence", err)
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
	// 这里不能用username来拼接兜底邮箱，不然可能有用户在第三方注册了和本站邮箱相同的用户名，导致邮箱冲突或者伪造，生成随机邮箱
	if userInfo.Email == "" {
		userInfo.Email = fmt.Sprintf("%s@replace-to-your-email", utils.Strings.GenerateRandomString(10))
	}

	// 完成fallback赋值后最终检查必要字段
	if userInfo.Sub == "" {
		return nil, errs.New(http.StatusInternalServerError, "Missing required fields \"sub\"", nil)
	}
	if userInfo.Email == "" {
		return nil, errs.New(http.StatusInternalServerError, "Missing required fields \"email\"", nil)
	}
	if userInfo.PreferredUsername == "" {
		return nil, errs.New(http.StatusInternalServerError, "Missing required fields \"preferred_username\"", nil)
	}

	if req.IsBind {
		currentUser, userOk := ctxutils.GetCurrentUser(ctx)
		if currentUser == nil || !userOk {
			return nil, errs.ErrUnauthorized
		}
		// 检查该第三方账号是否已被绑定
		existingUserOpenID, err := repo.User.GetUserOpenIDByIssuerAndSub(oidcConfig.Issuer, userInfo.Sub)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			// 非找不到记录的其他错误
			logrus.Errorln("Failed to get user OpenID:", err)
			return nil, errs.ErrInternalServer
		}
		if existingUserOpenID != nil {
			// 已被绑定
			return nil, errs.New(http.StatusConflict, "This third-party account is already linked to another user", nil)
		}
		// 绑定当前登录用户和第三方账号
		userOpenID := &model.UserOpenID{
			UserID: currentUser.ID,
			Issuer: oidcConfig.Issuer,
			Sub:    userInfo.Sub,
		}

		if err = repo.User.CreateOrUpdateUserOpenID(userOpenID); err != nil {
			return nil, errs.New(http.StatusInternalServerError, "Failed to link third-party account", err)
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
		return nil, errs.ErrInternalServer
	}

	// 1. 曾经绑定过登录
	if userOpenID != nil {
		user, err := repo.User.GetUserByID(userOpenID.UserID)
		if err != nil {
			return nil, errs.ErrInternalServer
		}
		if err = repo.Session.CreateSession(&model.Session{
			UserID:    user.ID,
			SessionID: sessionId,
			UserIP:    utils.NewIPRecord(req.UserIP),
		}); err != nil {
			return nil, errs.New(http.StatusInternalServerError, "Failed to create session", nil)
		}
		token, refreshToken, err := utils.Jwt.New2Tokens(user.ID, sessionId, false)
		if err != nil {
			return nil, errs.New(http.StatusInternalServerError, "Failed to generate tokens", err)
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
		return nil, errs.New(http.StatusInternalServerError, "Error to get user by email", err)
	}
	if localUser != nil {
		// 存在则绑定并签发token
		userOpenID = &model.UserOpenID{
			UserID: localUser.ID,
			Issuer: oidcConfig.Issuer,
			Sub:    userInfo.Sub,
		}
		if err = repo.User.CreateOrUpdateUserOpenID(userOpenID); err != nil {
			return nil, errs.New(http.StatusInternalServerError, "Failed to link third-party account", err)
		}
		if err = repo.Session.CreateSession(&model.Session{
			UserID:    localUser.ID,
			SessionID: sessionId,
			UserIP:    utils.NewIPRecord(req.UserIP),
		}); err != nil {
			return nil, errs.New(http.StatusInternalServerError, "Failed to create session", nil)
		}
		token, refreshToken, err := utils.Jwt.New2Tokens(localUser.ID, sessionId, false)
		if err != nil {
			return nil, errs.New(http.StatusInternalServerError, "Failed to generate tokens", err)
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
		return nil, errs.New(http.StatusForbidden, "Registration is disabled", nil)
	}
	// 检测用户名是否重复
	usernameExists, err := repo.User.CheckUsernameExists(userInfo.PreferredUsername)
	if err != nil {
		return nil, errs.New(http.StatusInternalServerError, "Failed to check username existence", err)
	}
	// 如果用户名已存在，尝试添加随机后缀
	if usernameExists {
		for i := 0; i < 10; i++ { // 最多尝试10次
			randomSuffix := utils.Strings.GenerateRandomString(6)
			newUsername := userInfo.PreferredUsername + "_" + randomSuffix
			exists, err := repo.User.CheckUsernameExists(newUsername)
			if err != nil {
				return nil, errs.New(http.StatusInternalServerError, "Failed to check username existence", err)
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
		return nil, errs.New(http.StatusInternalServerError, "Failed to create user", err)
	}
	// 创建管理员
	if newUser.ID == 1 {
		newUser.Role = constant.RoleAdmin
		if err = repo.User.UpdateUser(newUser); err != nil {
			logrus.Errorln("Failed to update user role to admin:", err)
			return nil, errs.ErrInternalServer
		}
	}
	userOpenID = &model.UserOpenID{
		UserID: newUser.ID,
		Issuer: oidcConfig.Issuer,
		Sub:    userInfo.Sub,
	}
	if err = repo.User.CreateOrUpdateUserOpenID(userOpenID); err != nil {
		return nil, errs.New(http.StatusInternalServerError, "Failed to link third-party account", err)
	}
	if err = repo.Session.CreateSession(&model.Session{
		UserID:    newUser.ID,
		SessionID: sessionId,
		UserIP:    utils.NewIPRecord(req.UserIP),
	}); err != nil {
		return nil, errs.New(http.StatusInternalServerError, "Failed to create session", nil)
	}
	token, refreshToken, err := utils.Jwt.New2Tokens(newUser.ID, sessionId, false)
	if err != nil {
		return nil, errs.New(http.StatusInternalServerError, "Failed to generate tokens", err)
	}
	resp := &dto.OidcLoginResp{
		Token:        token,
		RefreshToken: refreshToken,
		User:         newUser.ToDto(),
	}
	return resp, nil
}

func (s *UserService) GetUser(req *dto.GetUserReq) (*dto.GetUserResp, error) {
	if req.UserID == 0 {
		return nil, errs.New(http.StatusBadRequest, "user_id is required", nil)
	}
	user, err := repo.User.GetUserByID(req.UserID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.ErrNotFound
		}
		logrus.Errorln("Failed to get user by ID:", err)
		return nil, errs.ErrInternalServer
	}
	if user == nil {
		return nil, errs.ErrNotFound
	}
	return &dto.GetUserResp{
		User: user.ToDto(),
	}, nil
}

func (s *UserService) GetUserByUsername(req *dto.GetUserByUsernameReq) (*dto.GetUserResp, error) {
	if req.Username == "" {
		return nil, errs.New(http.StatusBadRequest, "username is required", nil)
	}
	user, err := repo.User.GetUserByUsername(req.Username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.ErrNotFound
		}
		logrus.Errorln("Failed to get user by username:", err)
		return nil, errs.ErrInternalServer
	}
	if user == nil {
		return nil, errs.ErrNotFound
	}
	return &dto.GetUserResp{
		User: user.ToDto(),
	}, nil
}

func (s *UserService) UpdateUser(req *dto.UpdateUserReq) (*dto.UpdateUserResp, error) {
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
			return nil, errs.ErrNotFound
		}
		logrus.Errorln("Failed to update user:", err)
		return nil, err
	}
	return &dto.UpdateUserResp{}, nil
}

func (s *UserService) UpdatePassword(ctx context.Context, req *dto.UpdatePasswordReq) (bool, error) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok || currentUser == nil {
		return false, errs.ErrUnauthorized
	}
	if !utils.Password.VerifyPassword(req.OldPassword, currentUser.Password) {
		return false, errs.New(http.StatusForbidden, "Old password is incorrect", nil)
	}
	hashedPassword, err := utils.Password.HashPassword(req.NewPassword)
	if err != nil {
		logrus.Errorln("Failed to update password:", err)
	}
	currentUser.Password = hashedPassword
	err = repo.GetDB().Save(currentUser).Error
	if err != nil {
		return false, errs.ErrInternalServer
	}
	return true, nil
}

func (s *UserService) ResetPassword(req *dto.ResetPasswordReq) (bool, error) {
	user, err := repo.User.GetUserByEmail(req.Email)
	if err != nil {
		return false, errs.ErrInternalServer
	}
	hashedPassword, err := utils.Password.HashPassword(req.NewPassword)
	if err != nil {
		return false, errs.ErrInternalServer
	}
	user.Password = hashedPassword
	err = repo.User.UpdateUser(user)
	if err != nil {
		return false, errs.ErrInternalServer
	}
	return true, nil
}

func (s *UserService) UpdateEmail(ctx context.Context, email string) (bool, error) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok || currentUser == nil {
		return false, errs.ErrUnauthorized
	}
	currentUser.Email = email
	err := repo.GetDB().Save(currentUser).Error
	if err != nil {
		return false, errs.ErrInternalServer
	}
	return true, nil
}
