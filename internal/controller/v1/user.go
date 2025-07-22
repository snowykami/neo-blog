package v1

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
)

type userType struct {
	service service.UserService
}

var User = &userType{
	service: service.NewUserService(),
}

func (u *userType) Login(ctx context.Context, c *app.RequestContext) {
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
	if resp == nil {
		resps.UnAuthorized(c, resps.ErrInvalidCredentials)
		return
	} else {
		u.setTokenCookie(c, resp.Token, resp.RefreshToken)
		resps.Ok(c, resps.Success, resp)
	}
}

func (u *userType) Register(ctx context.Context, c *app.RequestContext) {
	var userRegisterReq dto.UserRegisterReq
	if err := c.BindAndValidate(&userRegisterReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, err := u.service.UserRegister(&userRegisterReq)

	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	if resp == nil {
		resps.UnAuthorized(c, resps.ErrInvalidCredentials)
		return
	}
	u.setTokenCookie(c, resp.Token, resp.RefreshToken)
	resps.Ok(c, resps.Success, resp)
}

func (u *userType) Logout(ctx context.Context, c *app.RequestContext) {
	u.clearTokenCookie(c)
	resps.Ok(c, resps.Success, nil)
}

func (u *userType) OidcList(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) OidcLogin(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) Get(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) Update(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) Delete(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (u *userType) VerifyEmail(ctx context.Context, c *app.RequestContext) {
	var verifyEmailReq dto.VerifyEmailReq
	if err := c.BindAndValidate(&verifyEmailReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, err := u.service.VerifyEmail(&verifyEmailReq)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (u *userType) setTokenCookie(c *app.RequestContext, token, refreshToken string) {
	c.SetCookie("token", token, utils.Env.GetAsInt(constant.EnvKeyTokenDuration, constant.EnvKeyTokenDurationDefault), "/", "", protocol.CookieSameSiteLaxMode, true, true)
	c.SetCookie("refresh_token", refreshToken, -1, "/", "", protocol.CookieSameSiteLaxMode, true, true)
}

func (u *userType) clearTokenCookie(c *app.RequestContext) {
	c.SetCookie("token", "", -1, "/", "", protocol.CookieSameSiteLaxMode, true, true)
	c.SetCookie("refresh_token", "", -1, "/", "", protocol.CookieSameSiteLaxMode, true, true)
}
