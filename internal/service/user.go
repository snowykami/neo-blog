package service

import (
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/static"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"net/http"
	"time"
)

type UserService interface {
	UserLogin(*dto.UserLoginReq) (*dto.UserLoginResp, error)
	UserRegister(*dto.UserRegisterReq) (*dto.UserRegisterResp, error)
	VerifyEmail(*dto.VerifyEmailReq) (*dto.VerifyEmailResp, error)
	// TODO impl other user-related methods
}

type userService struct{}

func NewUserService() UserService {
	return &userService{}
}

func (s *userService) UserLogin(req *dto.UserLoginReq) (*dto.UserLoginResp, error) {
	user, err := repo.User.GetByUsernameOrEmail(req.Username)
	if err != nil {
		return nil, errs.ErrInternalServer
	}
	if user == nil {
		return nil, errs.ErrNotFound
	}
	if utils.Password.VerifyPassword(req.Password, user.Password, utils.Env.Get(constant.EnvKeyPasswordSalt, "default_salt")) {

		token := utils.Jwt.NewClaims(user.ID, "", false, time.Duration(utils.Env.GetAsInt(constant.EnvKeyTokenDuration, 24)*int(time.Hour)))
		tokenString, err := token.ToString()
		if err != nil {
			return nil, errs.ErrInternalServer
		}

		refreshToken := utils.Jwt.NewClaims(user.ID, utils.Strings.GenerateRandomString(64), true, time.Duration(utils.Env.GetAsInt(constant.EnvKeyRefreshTokenDuration, 30)*int(time.Hour)))
		refreshTokenString, err := refreshToken.ToString()
		if err != nil {
			return nil, errs.ErrInternalServer
		}
		// 对refresh token进行持久化存储
		err = repo.Session.SaveSession(refreshToken.SessionKey)
		if err != nil {
			return nil, errs.ErrInternalServer
		}
		resp := &dto.UserLoginResp{
			Token:        tokenString,
			RefreshToken: refreshTokenString,
			User:         user.ToDto(),
		}
		return resp, nil
	} else {
		return nil, errs.ErrInternalServer
	}
}

func (s *userService) UserRegister(req *dto.UserRegisterReq) (*dto.UserRegisterResp, error) {
	// 验证邮箱验证码
	if !utils.Env.GetAsBool("ENABLE_REGISTER", true) {
		return nil, errs.ErrForbidden
	}
	if utils.Env.GetAsBool("ENABLE_EMAIL_VERIFICATION", true) {
		kv := utils.KV.GetInstance()
		verificationCode, ok := kv.Get(constant.KVKeyEmailVerificationCode + ":" + req.Email)
		if !ok || verificationCode != req.VerificationCode {
			return nil, errs.ErrInvalidCredentials
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
	err = repo.User.Create(newUser)
	if err != nil {
		return nil, errs.ErrInternalServer
	}
	// 生成访问令牌和刷新令牌
	token := utils.Jwt.NewClaims(newUser.ID, "", false, time.Duration(utils.Env.GetAsInt(constant.EnvKeyTokenDuration, 24)*int(time.Hour)))
	tokenString, err := token.ToString()
	if err != nil {
		return nil, errs.ErrInternalServer
	}
	refreshToken := utils.Jwt.NewClaims(newUser.ID, utils.Strings.GenerateRandomString(64), true, time.Duration(utils.Env.GetAsInt(constant.EnvKeyRefreshTokenDuration, 30)*int(time.Hour)))
	refreshTokenString, err := refreshToken.ToString()
	if err != nil {
		return nil, errs.ErrInternalServer
	}
	// 对refresh token进行持久化存储
	err = repo.Session.SaveSession(refreshToken.SessionKey)
	if err != nil {
		return nil, errs.ErrInternalServer
	}

	resp := &dto.UserRegisterResp{
		Token:        tokenString,
		RefreshToken: refreshTokenString,
		User:         newUser.ToDto(),
	}
	return resp, nil
}

func (s *userService) VerifyEmail(req *dto.VerifyEmailReq) (*dto.VerifyEmailResp, error) {
	generatedVerificationCode := utils.Strings.GenerateRandomStringWithCharset(6, "0123456789abcdef")
	kv := utils.KV.GetInstance()
	kv.Set(constant.KVKeyEmailVerificationCode+":"+req.Email, generatedVerificationCode, time.Minute*10)

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
