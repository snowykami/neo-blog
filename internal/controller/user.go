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
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/ipregion"
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
		resps.BadRequest(c, "email_cannot_be_empty")
		return
	}
	if userRegisterReq.Password == "" || userRegisterReq.Username == "" {
		resps.BadRequest(c, "username_and_password_required")
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
	sessionId, _ := ctx.Value("session_id").(string)
	if sessionId == "" {
		resps.Ok(c, resps.Success, nil)
		return
	}
	// 服务端删除Session
	err := repo.Session.RevokeSession(sessionId)
	if err != nil {
		resps.InternalError(c, err)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

// SearchUsers 提及功能里的候选用户搜索
func (u *UserController) SearchUsers(ctx context.Context, c *app.RequestContext) {
	req := &dto.SearchUsersReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	users, svcerr := u.service.SearchUsers(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"users": users})
}

func (u *UserController) GetUser(ctx context.Context, c *app.RequestContext) {
	userID := ctxutils.GetIDParam(c).Uint
	resp, svcerr := u.service.GetUser(ctx, &dto.GetUserReq{UserID: userID})
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
	resp, svcerr := u.service.GetUser(ctx, &dto.GetUserReq{UserID: userID})
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
	resp, svcerr := u.service.GetUserByUsername(ctx, &dto.GetUserByUsernameReq{Username: username})
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
			resps.BadRequest(c, "invalid_avatar_url")
			return
		}
	}
	if updateUserReq.BackgroundUrl != "" {
		pass2 := utils2.Url.IsValidUrl(updateUserReq.BackgroundUrl)
		if !pass2 {
			resps.BadRequest(c, "invalid_background_url")
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
	userID, _ := ctxutils.GetCurrentUserID(ctx)
	verifyEmailReq := dto.VerifyEmailReq{UserIP: c.ClientIP(), UserID: userID}
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
	ok, svcerr := u.service.UpdatePassword(ctx, &updatePasswordReq)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	if !ok {
		resps.BadRequest(c, "failed_to_change_password")
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
	resetPasswordReq.Email = strings.TrimSpace(string(c.GetHeader("X-Email")))
	verifyCode := strings.TrimSpace(string(c.GetHeader("X-Verify-Code")))
	ok, svcerr := u.service.ResetPassword(&resetPasswordReq, verifyCode)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	if !ok {
		resps.BadRequest(c, "failed_to_reset_password")
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (u *UserController) ChangeEmail(ctx context.Context, c *app.RequestContext) {
	email := strings.TrimSpace(string(c.GetHeader("X-Email")))
	verifyCode := strings.TrimSpace(string(c.GetHeader("X-Verify-Code")))
	ok, svcerr := u.service.UpdateEmail(ctx, email, verifyCode)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	if !ok {
		resps.BadRequest(c, "failed_to_change_email")
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (u *UserController) GetCaptchaConfig(ctx context.Context, c *app.RequestContext) {
	// 只公开前端渲染组件所需的提供方与站点 Key，密钥不外传
	captcha := tools.GetCaptchaConfig()
	resps.Ok(c, "ok", utils.H{
		"provider": captcha.Type,
		"site_key": captcha.SiteKey,
	})
}

func (u *UserController) GetUserLastIPLocation(ctx context.Context, c *app.RequestContext) {
	userID := ctxutils.GetIDParam(c).Uint
	user, err := repo.User.GetUserByID(userID)
	if err != nil {
		resps.Error(c, errs.FromDB(err, "user", "failed_to_get_user"))
		return
	}
	if user.ShowIPLocation == nil || !*user.ShowIPLocation {
		resps.Forbidden(c, "ip_location_hidden")
		return
	}
	// 获取用户最新的session
	session, err := repo.Session.GetLatestSessionByUserID(userID)
	if err != nil {
		resps.Error(c, errs.FromDB(err, "session", "failed_to_get_target"))
		return
	}
	// 使用本地离线 ip2region 查询归属地，不把用户会话 IP 发送给第三方在线接口
	reg := ipregion.Lookup(session.LatestIP())
	ipInfo := &utils2.IPData{}
	if !reg.Reserved {
		ipInfo.Country = reg.Country
		ipInfo.CountryCode = reg.CountryCode
		ipInfo.Province = reg.Province
		ipInfo.City = reg.City
		ipInfo.ISP = reg.ISP
		if ipInfo.Province == ipInfo.Country {
			ipInfo.Province = ""
		}
		if ipInfo.City == ipInfo.Province {
			ipInfo.City = ""
		}
	}
	resps.Ok(c, resps.Success, ipInfo)
}
