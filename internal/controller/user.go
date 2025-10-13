package v1

import (
	"context"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	utils2 "github.com/snowykami/neo-blog/pkg/utils"
)

type UserController struct {
	service *service.UserService
}

func NewUserController() *UserController {
	return &UserController{
		service: service.NewUserService(),
	}
}

func (u *UserController) Login(ctx context.Context, c *app.RequestContext) {
	// 绑定参数
	userLoginReq := dto.UserLoginReq{
		UserIP: c.ClientIP(),
	}
	if err := c.BindAndValidate(&userLoginReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 校验输入
	if userLoginReq.Password == "" || userLoginReq.Username == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 处理请求
	resp, svcerr := u.service.UserLogin(&userLoginReq)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	// 设置Cookie并响应
	ctxutils.Set2Tokens(c, resp.Token, resp.RefreshToken)
	resps.Ok(c, resps.Success, utils.H{
		"token": resp.Token,
		"user":  resp.User,
	})
}

func (u *UserController) Register(ctx context.Context, c *app.RequestContext) {
	// 绑定参数
	userRegisterReq := dto.UserRegisterReq{
		UserIP: c.ClientIP(),
	}
	if err := c.BindAndValidate(&userRegisterReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 校验输入
	if userRegisterReq.Email == "" {
		resps.BadRequest(c, "Email header is required")
		return
	}
	if userRegisterReq.Password == "" || userRegisterReq.Username == "" {
		resps.BadRequest(c, "Username and password are required")
		return
	}
	// 从Header获取Email
	resp, svcerr := u.service.UserRegister(&userRegisterReq)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	// 设置Cookie并响应
	ctxutils.Set2Tokens(c, resp.Token, resp.RefreshToken)
	resps.Ok(c, resps.Success, utils.H{
		"token": resp.Token,
		"user":  resp.User,
	})
}

func (u *UserController) Logout(ctx context.Context, c *app.RequestContext) {
	// 清除客户端Cookie
	ctxutils.Clear2Tokens(c)
	sessionId := ctx.Value("session_id").(string)
	if sessionId == "" {
		resps.Ok(c, resps.Success, nil)
		return
	}
	// 服务端删除Session
	err := repo.Session.RevokeSession(sessionId)
	if err != nil {
		resps.InternalServerError(c, err.Error())
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (u *UserController) GetUser(ctx context.Context, c *app.RequestContext) {
	userID := ctxutils.GetIDParam(c).Uint
	resp, svcerr := u.service.GetUser(&dto.GetUserReq{UserID: userID})
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp.User)
}

func (u *UserController) GetLoginUser(ctx context.Context, c *app.RequestContext) {
	userID, ok := ctxutils.GetCurrentUserID(ctx)
	if !ok {
		resps.Unauthorized(c, resps.ErrUnauthorized)
		return
	}
	resp, svcerr := u.service.GetUser(&dto.GetUserReq{UserID: userID})
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp.User)
}

func (u *UserController) GetUserByUsername(ctx context.Context, c *app.RequestContext) {
	username := c.Param("username")
	if username == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := u.service.GetUserByUsername(&dto.GetUserByUsernameReq{Username: username})
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp.User)
}

func (u *UserController) UpdateUser(ctx context.Context, c *app.RequestContext) {
	var updateUserReq dto.UpdateUserReq
	if err := c.BindAndValidate(&updateUserReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 检测头像链接
	if updateUserReq.AvatarUrl != "" {
		pass1 := utils2.Url.IsValidUrl(updateUserReq.AvatarUrl)
		if !pass1 {
			resps.BadRequest(c, "Avatar URL is invalid")
			return
		}
	}
	if updateUserReq.BackgroundUrl != "" {
		pass2 := utils2.Url.IsValidUrl(updateUserReq.BackgroundUrl)
		if !pass2 {
			resps.BadRequest(c, "Background URL is invalid")
			return
		}
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, updateUserReq.ID) || ctxutils.IsAdmin(ctx)) {
		resps.Forbidden(c, resps.ErrForbidden)
		return
	}
	resp, svcerr := u.service.UpdateUser(&updateUserReq)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (u *UserController) VerifyEmail(ctx context.Context, c *app.RequestContext) {
	var verifyEmailReq dto.VerifyEmailReq
	if err := c.BindAndValidate(&verifyEmailReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if verifyEmailReq.Email == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := u.service.RequestVerifyEmail(&verifyEmailReq)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (u *UserController) ChangePassword(ctx context.Context, c *app.RequestContext) {
	var updatePasswordReq dto.UpdatePasswordReq
	if err := c.BindAndValidate(&updatePasswordReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	ok, err := u.service.UpdatePassword(ctx, &updatePasswordReq)
	if err != nil {
		resps.InternalServerError(c, err.Error())
		return
	}
	if !ok {
		resps.BadRequest(c, "Failed to change password")
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (u *UserController) ResetPassword(ctx context.Context, c *app.RequestContext) {
	var resetPasswordReq dto.ResetPasswordReq
	if err := c.BindAndValidate(&resetPasswordReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	email := strings.TrimSpace(string(c.GetHeader("X-Email")))
	if email == "" {
		resps.BadRequest(c, "Email header is required")
		return
	}
	resetPasswordReq.Email = email
	ok, err := u.service.ResetPassword(&resetPasswordReq)
	if err != nil {
		resps.InternalServerError(c, err.Error())
		return
	}
	if !ok {
		resps.BadRequest(c, "Failed to reset password")
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (u *UserController) ChangeEmail(ctx context.Context, c *app.RequestContext) {
	email := strings.TrimSpace(string(c.GetHeader("X-Email")))
	if email == "" {
		resps.BadRequest(c, "Email header is required")
		return
	}
	ok, err := u.service.UpdateEmail(ctx, email)
	if err != nil {
		resps.InternalServerError(c, err.Error())
		return
	}
	if !ok {
		resps.BadRequest(c, "Failed to change email")
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (u *UserController) GetCaptchaConfig(ctx context.Context, c *app.RequestContext) {
	resps.Ok(c, "ok", utils.H{
		"provider": utils2.Env.Get(constant.EnvKeyCaptchaProvider),
		"site_key": utils2.Env.Get(constant.EnvKeyCaptchaSiteKey),
		"url":      utils2.Env.Get(constant.EnvKeyCaptchaUrl),
	})
}

func (u *UserController) GetUserLastIPLocation(ctx context.Context, c *app.RequestContext) {
	userID := ctxutils.GetIDParam(c).Uint
	// 获取用户最新的session
	session, err := repo.Session.GetLatestSessionByUserID(userID)
	if err != nil {
		resps.InternalServerError(c, "Failed to get user session")
		return
	}
	user, err := repo.User.GetUserByID(userID)
	if *user.ShowIPLocation == false {
		resps.Forbidden(c, "User has disabled IP location display")
		return
	}
	ipInfo, err := utils2.GetIPInfo(session.LatestIP())
	if err != nil {
		resps.InternalServerError(c, "Failed to get IP location")
		return
	}
	// 脱敏
	if ipInfo != nil {
		utils2.DesensitizeIpData(ipInfo)
	}
	resps.Ok(c, resps.Success, ipInfo)
}
