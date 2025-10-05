package v1

import (
	"context"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
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
	var userLoginReq dto.UserLoginReq
	if err := c.BindAndValidate(&userLoginReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, err := u.service.UserLogin(&userLoginReq)

	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	ctxutils.SetTokenAndRefreshTokenCookie(c, resp.Token, resp.RefreshToken)
	resps.Ok(c, resps.Success, utils.H{
		"token": resp.Token,
		"user":  resp.User,
	})
}

func (u *UserController) Register(ctx context.Context, c *app.RequestContext) {
	var userRegisterReq dto.UserRegisterReq
	if err := c.BindAndValidate(&userRegisterReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	email := strings.TrimSpace(string(c.GetHeader("X-Email")))
	if email == "" {
		resps.BadRequest(c, "Email header is required")
		return
	}
	userRegisterReq.Email = email
	resp, err := u.service.UserRegister(&userRegisterReq)

	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}

	ctxutils.SetTokenAndRefreshTokenCookie(c, resp.Token, resp.RefreshToken)
	resps.Ok(c, resps.Success, utils.H{
		"token": resp.Token,
		"user":  resp.User,
	})
}

func (u *UserController) Logout(ctx context.Context, c *app.RequestContext) {
	ctxutils.ClearTokenAndRefreshTokenCookie(c)
	resps.Ok(c, resps.Success, nil)
	// 尝试吊销服务端状态：若用户登录的情况下
	// TODO: 添加服务端状态的吊销逻辑
}

func (u *UserController) OidcList(ctx context.Context, c *app.RequestContext) {
	oidcConfigs, err := u.service.ListOidcConfigs()
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Error(), nil)
		return
	}
	resps.Ok(c, resps.Success, oidcConfigs)
}

func (u *UserController) OidcLogin(ctx context.Context, c *app.RequestContext) {
	req := &dto.OidcLoginReq{}
	if err := c.Bind(req); err != nil {
		resps.BadRequest(c, err.Error())
		return
	}
	resp, err := u.service.OidcLogin(ctx, req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Error(), nil)
		return
	}
	ctxutils.SetTokenAndRefreshTokenCookie(c, resp.Token, resp.RefreshToken)
	resps.Redirect(c, req.RedirectBack) // 重定向到前端路由
}

func (u *UserController) GetUser(ctx context.Context, c *app.RequestContext) {
	userID := ctxutils.GetIDParam(c).Uint
	resp, err := u.service.GetUser(&dto.GetUserReq{UserID: userID})
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
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
	resp, err := u.service.GetUser(&dto.GetUserReq{UserID: userID})
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
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
	resp, err := u.service.GetUserByUsername(&dto.GetUserByUsernameReq{Username: username})
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
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
	pass1 := utils2.Url.IsValidUrl(updateUserReq.AvatarUrl)
	pass2 := utils2.Url.IsValidUrl(updateUserReq.BackgroundUrl)
	if !pass1 || !pass2 {
		resps.BadRequest(c, "Avatar URL or Background URL is invalid")
		return
	}
	if !ctxutils.IsOwnerOfTarget(ctx, updateUserReq.ID) && !ctxutils.IsAdmin(ctx) {
		resps.Forbidden(c, resps.ErrForbidden)
		return
	}
	resp, err := u.service.UpdateUser(&updateUserReq)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, err.Error(), nil)
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
	}
	resp, err := u.service.RequestVerifyEmail(&verifyEmailReq)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
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
