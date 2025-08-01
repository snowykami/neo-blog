package service

import (
	"errors"
	"fmt"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/static"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
	"net/http"
	"strings"
	"time"
)

type UserService struct{}

func NewUserService() *UserService {
	return &UserService{}
}

func (s *UserService) UserLogin(req *dto.UserLoginReq) (*dto.UserLoginResp, error) {
	user, err := repo.User.GetUserByUsernameOrEmail(req.Username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			logrus.Warnf("User not found: %s", req.Username)
			return nil, errs.ErrNotFound
		}
		return nil, errs.ErrInternalServer
	}
	if user == nil {
		return nil, errs.ErrNotFound
	}
	if utils.Password.VerifyPassword(req.Password, user.Password, utils.Env.Get(constant.EnvKeyPasswordSalt, "default_salt")) {
		token, refreshToken, err := s.generate2Token(user.ID)
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
	} else {
		return nil, errs.ErrInternalServer
	}
}

func (s *UserService) UserRegister(req *dto.UserRegisterReq) (*dto.UserRegisterResp, error) {
	// 验证邮箱验证码
	if !utils.Env.GetAsBool("ENABLE_REGISTER", true) {
		return nil, errs.ErrForbidden
	}
	if utils.Env.GetAsBool("ENABLE_EMAIL_VERIFICATION", true) {
		ok, err := s.verifyEmail(req.Email, req.VerificationCode)
		if err != nil {
			logrus.Errorln("Failed to verify email:", err)
			return nil, errs.ErrInternalServer
		}
		if !ok {
			return nil, errs.New(http.StatusForbidden, "Invalid email verification code", nil)
		}
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
	hashedPassword, err := utils.Password.HashPassword(req.Password, utils.Env.Get(constant.EnvKeyPasswordSalt, "default_salt"))
	if err != nil {
		logrus.Errorln("Failed to hash password:", err)
		return nil, errs.ErrInternalServer
	}
	newUser := &model.User{
		Username: req.Username,
		Nickname: req.Nickname,
		Email:    req.Email,
		Gender:   "",
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
	// 生成访问令牌和刷新令牌
	token, refreshToken, err := s.generate2Token(newUser.ID)
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
	generatedVerificationCode := utils.Strings.GenerateRandomStringWithCharset(6, "0123456789abcdef")
	kv := utils.KV.GetInstance()
	kv.Set(constant.KVKeyEmailVerificationCode+req.Email, generatedVerificationCode, time.Minute*10)

	template, err := static.RenderTemplate("email/verification-code.tmpl", map[string]interface{}{})
	if err != nil {
		return nil, errs.ErrInternalServer
	}
	if utils.IsDevMode {
		logrus.Infof("%s's verification code is %s", req.Email, generatedVerificationCode)
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
		state := utils.Strings.GenerateRandomString(32)
		kvStore := utils.KV.GetInstance()
		kvStore.Set(constant.KVKeyOidcState+state, oidcConfig.Name, 5*time.Minute)
		loginUrl := utils.Url.BuildUrl(oidcConfig.AuthorizationEndpoint, map[string]string{
			"client_id": oidcConfig.ClientID,
			"redirect_uri": fmt.Sprintf("%s%s%s/%sREDIRECT_BACK", // 这个大占位符给前端替换用的，替换时也要uri编码因为是层层包的
				strings.TrimSuffix(utils.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl), "/"),
				constant.ApiSuffix,
				constant.OidcUri,
				oidcConfig.Name,
			),
			"response_type": "code",
			"scope":         "openid email profile",
			"state":         state,
		})

		if oidcConfig.Type == constant.OidcProviderTypeMisskey {
			// Misskey OIDC 特殊处理
			loginUrl = utils.Url.BuildUrl(oidcConfig.AuthorizationEndpoint, map[string]string{
				"client_id": oidcConfig.ClientID,
				"redirect_uri": fmt.Sprintf("%s%s%s/%s", // 这个大占位符给前端替换用的，替换时也要uri编码因为是层层包的
					strings.TrimSuffix(utils.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl), "/"),
					constant.ApiSuffix,
					constant.OidcUri,
					oidcConfig.Name,
				),
				"response_type": "code",
				"scope":         "read:account",
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

func (s *UserService) OidcLogin(req *dto.OidcLoginReq) (*dto.OidcLoginResp, error) {
	// 验证state
	kvStore := utils.KV.GetInstance()
	storedName, ok := kvStore.Get(constant.KVKeyOidcState + req.State)
	if !ok || storedName != req.Name {
		return nil, errs.New(http.StatusForbidden, "invalid oidc state", nil)
	}
	// 获取OIDC配置
	oidcConfig, err := repo.Oidc.GetOidcConfigByName(req.Name)
	if err != nil {
		return nil, errs.ErrInternalServer
	}
	if oidcConfig == nil {
		return nil, errs.New(http.StatusNotFound, "OIDC configuration not found", nil)
	}
	// 请求访问令牌
	tokenResp, err := utils.Oidc.RequestToken(
		oidcConfig.TokenEndpoint,
		oidcConfig.ClientID,
		oidcConfig.ClientSecret,
		req.Code,
		strings.TrimSuffix(utils.Env.Get(constant.EnvKeyBaseUrl, constant.DefaultBaseUrl), "/")+constant.OidcUri+oidcConfig.Name,
	)
	if err != nil {
		logrus.Errorln("Failed to request OIDC token:", err)
		return nil, errs.ErrInternalServer
	}
	userInfo, err := utils.Oidc.RequestUserInfo(oidcConfig.UserInfoEndpoint, tokenResp.AccessToken)
	if err != nil {
		logrus.Errorln("Failed to request OIDC user info:", err)
		return nil, errs.ErrInternalServer
	}

	// 绑定过登录
	userOpenID, err := repo.User.GetUserOpenIDByIssuerAndSub(oidcConfig.Issuer, userInfo.Sub)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.ErrInternalServer
	}
	if userOpenID != nil {
		user, err := repo.User.GetUserByID(userOpenID.UserID)
		if err != nil {
			return nil, errs.ErrInternalServer
		}
		token, refreshToken, err := s.generate2Token(user.ID)
		if err != nil {
			logrus.Errorln("Failed to generate tokens:", err)
			return nil, errs.ErrInternalServer
		}
		resp := &dto.OidcLoginResp{
			Token:        token,
			RefreshToken: refreshToken,
			User:         user.ToDto(),
		}
		return resp, nil
	} else {
		// 若没有绑定过登录，则先通过邮箱查找用户，若没有再创建新用户
		user, err := repo.User.GetUserByEmail(userInfo.Email)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			logrus.Errorln("Failed to get user by email:", err)
			return nil, errs.ErrInternalServer
		}
		if user != nil {
			userOpenID = &model.UserOpenID{
				UserID: user.ID,
				Issuer: oidcConfig.Issuer,
				Sub:    userInfo.Sub,
			}
			err = repo.User.CreateOrUpdateUserOpenID(userOpenID)
			if err != nil {
				logrus.Errorln("Failed to create or update user OpenID:", err)
				return nil, errs.ErrInternalServer
			}
			token, refreshToken, err := s.generate2Token(user.ID)
			if err != nil {
				logrus.Errorln("Failed to generate tokens:", err)
				return nil, errs.ErrInternalServer
			}
			resp := &dto.OidcLoginResp{
				Token:        token,
				RefreshToken: refreshToken,
				User:         user.ToDto(),
			}
			return resp, nil
		} else {
			user = &model.User{
				Username:  userInfo.Name,
				Nickname:  userInfo.Name,
				AvatarUrl: userInfo.Picture,
				Email:     userInfo.Email,
			}
			err = repo.User.CreateUser(user)
			if err != nil {
				logrus.Errorln("Failed to create user:", err)
				return nil, errs.ErrInternalServer
			}
			userOpenID = &model.UserOpenID{
				UserID: user.ID,
				Issuer: oidcConfig.Issuer,
				Sub:    userInfo.Sub,
			}
			err = repo.User.CreateOrUpdateUserOpenID(userOpenID)
			if err != nil {
				logrus.Errorln("Failed to create or update user OpenID:", err)
				return nil, errs.ErrInternalServer
			}
			token, refreshToken, err := s.generate2Token(user.ID)
			if err != nil {
				logrus.Errorln("Failed to generate tokens:", err)
				return nil, errs.ErrInternalServer
			}
			resp := &dto.OidcLoginResp{
				Token:        token,
				RefreshToken: refreshToken,
				User:         user.ToDto(),
			}
			return resp, nil
		}
	}
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

func (s *UserService) UpdateUser(req *dto.UpdateUserReq) (*dto.UpdateUserResp, error) {
	user := &model.User{
		Model: gorm.Model{
			ID: req.ID,
		},
		Username:  req.Username,
		Nickname:  req.Nickname,
		Gender:    req.Gender,
		AvatarUrl: req.AvatarUrl,
	}
	err := repo.User.UpdateUser(user)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.ErrNotFound
		}
		logrus.Errorln("Failed to update user:", err)
		return nil, errs.ErrInternalServer
	}
	return &dto.UpdateUserResp{}, nil
}

func (s *UserService) generate2Token(userID uint) (string, string, error) {
	token := utils.Jwt.NewClaims(userID, "", false, time.Duration(utils.Env.GetAsInt(constant.EnvKeyTokenDuration, constant.EnvKeyTokenDurationDefault))*time.Second)
	tokenString, err := token.ToString()
	if err != nil {
		return "", "", errs.ErrInternalServer
	}
	refreshToken := utils.Jwt.NewClaims(userID, utils.Strings.GenerateRandomString(64), true, time.Duration(utils.Env.GetAsInt(constant.EnvKeyRefreshTokenDuration, constant.EnvKeyRefreshTokenDurationDefault))*time.Second)
	refreshTokenString, err := refreshToken.ToString()
	if err != nil {
		return "", "", errs.ErrInternalServer
	}
	err = repo.Session.SaveSession(refreshToken.SessionKey)
	if err != nil {
		return "", "", errs.ErrInternalServer
	}
	return tokenString, refreshTokenString, nil
}

func (s *UserService) verifyEmail(email, code string) (bool, error) {
	kv := utils.KV.GetInstance()
	verificationCode, ok := kv.Get(constant.KVKeyEmailVerificationCode + email)
	if !ok || verificationCode != code {
		return false, errs.New(http.StatusForbidden, "Invalid email verification code", nil)
	}
	return true, nil
}
