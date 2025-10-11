package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

// OidcLogin 此函数用于oidc provider响应给前端的重定向
func (s *UserService) OidcLogin(ctx context.Context, req *dto.OidcLoginReq) (*dto.OidcLoginResp, *errs.ServiceError) {
	// 验证 state（包括 misskey session 回退）
	kvStore := utils.KV.GetInstance()
	storedName, ok := kvStore.Get("oidc_state:" + req.State)
	if !ok || storedName != req.Name {
		if req.Session != "" {
			storedName, ok = kvStore.Get("oidc_state:" + req.Session)
			if !ok || storedName != req.Name {
				return nil, errs.NewBadRequest("invalid_oidc_state")
			}
		} else {
			return nil, errs.NewBadRequest("invalid_oidc_state")
		}
	}

	// 获取 OIDC 配置
	oidcConfig, serr := s.getOidcConfig(req.Name)
	if serr != nil {
		return nil, serr
	}

	// 交换 token 并获取 userinfo（含 GitHub 特例）
	userInfo, serr := s.exchangeAndFetchUserinfo(oidcConfig, req)
	if serr != nil {
		return nil, serr
	}

	// 填充 fallback email
	if userInfo.Email == "" {
		userInfo.Email = fmt.Sprintf("%s@replace-to-your-email", utils.Strings.GenerateRandomString(10))
	}

	// 必要字段校验
	if userInfo.Sub == "" {
		return nil, errs.NewInternalServer("missing_required_oidc_field_sub")
	}
	if userInfo.Email == "" {
		return nil, errs.NewInternalServer("missing_required_oidc_field_email")
	}
	if userInfo.PreferredUsername == "" {
		return nil, errs.NewInternalServer("missing_required_oidc_field_preferred_username")
	}

	// 处理登录/绑定/注册流程（包含 session 创建与 token 签发）
	return s.finalizeUserFromUserinfo(ctx, req, oidcConfig, userInfo)
}

// helper: 根据 userinfo 完成绑定 / 登录 / 创建 用户并返回 token response
func (s *UserService) finalizeUserFromUserinfo(ctx context.Context, req *dto.OidcLoginReq, oidcConfig *model.OidcConfig, userInfo *utils.Userinfo) (*dto.OidcLoginResp, *errs.ServiceError) {
	// 绑定流程
	if req.IsBind {
		currentUser, userOk := ctxutils.GetCurrentUser(ctx)
		if currentUser == nil || !userOk {
			return nil, errs.NewUnauthorized("login_required")
		}
		existingUserOpenID, err := repo.User.GetUserOpenIDByIssuerAndSub(oidcConfig.Issuer, userInfo.Sub)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			logrus.Errorln("Failed to get user OpenID:", err)
			return nil, errs.NewInternalServer("failed_to_get_user_openid")
		}
		if existingUserOpenID != nil {
			// 已经绑定过的账号，不绑定直接登录，同时更新信息
			if err = s.updateUserOpenIdInfo(existingUserOpenID, userInfo); err != nil {
				return nil, errs.NewInternalServer("failed_to_update_target")
			}
			token, refreshToken, err := utils.Jwt.New2Tokens(existingUserOpenID.UserID, "", false)
			if err != nil {
				return nil, errs.NewInternalServer("failed_to_create_target")
			}
			return &dto.OidcLoginResp{
				Token:        token,
				RefreshToken: refreshToken,
				User:         existingUserOpenID.User.ToDto(),
			}, nil
		}
		// 绑定到当前登录用户并更新信息
		userOpenID := &model.UserOpenID{
			UserID: currentUser.ID,
			Issuer: oidcConfig.Issuer,
			Sub:    userInfo.Sub,
		}
		if err = repo.User.CreateOrUpdateUserOpenID(userOpenID); err != nil {
			return nil, errs.NewConflict("failed_to_link_oidc_account")
		}
		if err = s.updateUserOpenIdInfo(userOpenID, userInfo); err != nil {
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
		return &dto.OidcLoginResp{
			Token:        "",
			RefreshToken: "",
			User:         currentUser.ToDto(),
		}, nil
	}

	// 非绑定：生成 sessionId，用于登录/注册
	sessionId := utils.Strings.GenerateRandomString(32)

	// 1) 尝试查找曾经绑定过的登录
	userOpenID, err := repo.User.GetUserOpenIDByIssuerAndSub(oidcConfig.Issuer, userInfo.Sub)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.NewInternalServer("failed_to_get_user_openid")
	}
	if userOpenID != nil {
		// openid不为空，则查找到了，更新信息并登录
		user, err := repo.User.GetUserByID(userOpenID.UserID)
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_get_user")
		}
		// 更新openid信息，不致命错误不阻断登录
		if err = s.updateUserOpenIdInfo(userOpenID, userInfo); err != nil {
			return nil, errs.NewInternalServer("failed_to_update_target")
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
		return &dto.OidcLoginResp{
			Token:        token,
			RefreshToken: refreshToken,
			User:         user.ToDto(),
		}, nil
	}

	// 2) 尝试邮箱匹配的本地账户 -> 绑定并登录
	localUser, err := repo.User.GetUserByEmail(userInfo.Email)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.NewInternalServer("failed_to_get_user")
	}
	if localUser != nil {
		userOpenID = &model.UserOpenID{
			UserID: localUser.ID,
			Issuer: oidcConfig.Issuer,
			Sub:    userInfo.Sub,
		}
		if err = repo.User.CreateOrUpdateUserOpenID(userOpenID); err != nil {
			return nil, errs.NewConflict("failed_to_link_oidc_account")
		}
		// 更新openid信息，上一步保存后模型就有主键ID，不致命错误不阻断登录
		if err = s.updateUserOpenIdInfo(userOpenID, userInfo); err != nil {
			return nil, errs.NewInternalServer("failed_to_update_target")
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

		return &dto.OidcLoginResp{
			Token:        token,
			RefreshToken: refreshToken,
			User:         localUser.ToDto(),
		}, nil
	}

	// 3) 第一次登录，创建新用户
	if !tools.GetAllowRegisterFromOidc() {
		return nil, errs.NewForbidden("register_from_oidc_disabled")
	}

	usernameExists, err := repo.User.CheckUsernameExists(userInfo.PreferredUsername)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_check_target")
	}
	if usernameExists {
		for i := 0; i < 10; i++ {
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
	// 更新openid信息，不致命错误不阻断登录
	if err = s.updateUserOpenIdInfo(userOpenID, userInfo); err != nil {
		return nil, errs.NewInternalServer("failed_to_update_target")
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
	return &dto.OidcLoginResp{
		Token:        token,
		RefreshToken: refreshToken,
		User:         newUser.ToDto(),
	}, nil
}

// helper: 获取 oidc 配置
func (s *UserService) getOidcConfig(name string) (*model.OidcConfig, *errs.ServiceError) {
	oidcConfig, err := repo.Oidc.GetOidcConfigByName(name)
	if err != nil || oidcConfig == nil {
		return nil, errs.NewBadRequest("invalid_oidc_name")
	}
	return oidcConfig, nil
}

// helper: 交换 token 并获取 userinfo（包含 misskey / github 特例）
func (s *UserService) exchangeAndFetchUserinfo(oidcConfig *model.OidcConfig, req *dto.OidcLoginReq) (*utils.Userinfo, *errs.ServiceError) {
	userInfo := &utils.Userinfo{}
	if oidcConfig.Type == "misskey" {
		misskeyTokenResp, err := utils.Oidc.RequestMisskeyToken(oidcConfig.TokenEndpoint, req.Session)
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_request_oidc_token")
		}
		userInfo.Sub = misskeyTokenResp.User.ID
		userInfo.Name = misskeyTokenResp.User.Name
		userInfo.PreferredUsername = misskeyTokenResp.User.Username
		userInfo.Email = misskeyTokenResp.User.Email
		userInfo.Picture = misskeyTokenResp.User.AvatarUrl
		return userInfo, nil
	}

	// 标准 OIDC/OAuth2 流程
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
	userInfo, err = utils.Oidc.RequestUserinfo(oidcConfig.UserinfoEndpoint, tokenResp.AccessToken)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_request_oidc_userinfo")
	}

	// GitHub 特例：补充字段与优先邮箱选择
	if strings.Contains(oidcConfig.TokenEndpoint, "https://github.com") {
		userInfo.Picture = userInfo.AvatarUrl
		userInfo.PreferredUsername = userInfo.Login
		if userInfo.Sub == "" && userInfo.ID != 0 {
			userInfo.Sub = fmt.Sprintf("github:%d", userInfo.ID)
		}
		emails, err := utils.Oidc.RequestGitHubUserVerifiedEmails(tokenResp.AccessToken)
		if err != nil {
			return nil, errs.NewInternalServer("failed_to_request_oidc_userinfo")
		}
		if len(emails) > 0 {
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

	return userInfo, nil
}

// updateUserOpenIdInfo 更新用户OpenID信息
func (s *UserService) updateUserOpenIdInfo(userOpenId *model.UserOpenID, userInfo *utils.Userinfo) error {
	if userOpenId == nil {
		return errors.New("userOpenId is nil")
	}
	userOpenId.Name = userInfo.Name
	userOpenId.Email = userInfo.Email
	userOpenId.Picture = userInfo.Picture
	userOpenId.PreferredUsername = userInfo.PreferredUsername
	return repo.User.UpdateUserOpenID(userOpenId)
}
