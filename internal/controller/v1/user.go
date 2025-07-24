package v1

import (
	"context"
	"fmt"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
	"strconv"
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
}

func (u *UserController) OidcList(ctx context.Context, c *app.RequestContext) {
	resp, err := u.service.ListOidcConfigs()
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, map[string]any{
		"oidc_configs": resp.OidcConfigs,
	})
}

func (u *UserController) OidcLogin(ctx context.Context, c *app.RequestContext) {
	name := c.Param("name")
	code := c.Query("code")
	state := c.Query("state")
	redirectUri := c.Query("redirect_back") // 前端路由登录前的重定向地址
	if redirectUri == "" {
		redirectUri = "/"
	}
	fmt.Println("redirectBack:", redirectUri)
	oidcLoginReq := &dto.OidcLoginReq{
		Name:  name,
		Code:  code,
		State: state,
	}
	resp, err := u.service.OidcLogin(oidcLoginReq)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	ctxutils.SetTokenAndRefreshTokenCookie(c, resp.Token, resp.RefreshToken)
	resps.Redirect(c, redirectUri) // 重定向到前端路由
}

func (u *UserController) GetUser(ctx context.Context, c *app.RequestContext) {
	userID := c.Param("id")
	userIDInt, err := strconv.Atoi(userID)
	if err != nil || userIDInt <= 0 {
		userIDInt = int(ctxutils.GetCurrentUserID(ctx))
	}

	resp, err := u.service.GetUser(&dto.GetUserReq{UserID: uint(userIDInt)})
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, resp.User)
}

func (u *UserController) UpdateUser(ctx context.Context, c *app.RequestContext) {
	userID := c.Param("id")
	if userID == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	userIDInt, err := strconv.Atoi(userID)
	if err != nil || userIDInt <= 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	var updateUserReq dto.UpdateUserReq
	if err := c.BindAndValidate(&updateUserReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	updateUserReq.ID = uint(userIDInt)
	currentUser := ctxutils.GetCurrentUser(ctx)
	if currentUser == nil {
		resps.Unauthorized(c, resps.ErrUnauthorized)
		return
	}
	if currentUser.ID != updateUserReq.ID {
		resps.Forbidden(c, resps.ErrForbidden)
		return
	}
	resp, err := u.service.UpdateUser(&updateUserReq)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
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
	resp, err := u.service.RequestVerifyEmail(&verifyEmailReq)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, resp)
}
