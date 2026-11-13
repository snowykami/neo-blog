package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/resps"
)

// GetOidcConfigList 已启用的第三方登录，只含展示信息
func (u *UserController) GetOidcConfigList(ctx context.Context, c *app.RequestContext) {
	oidcConfigs, svcerr := u.service.ListOidcConfigs()
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, oidcConfigs)
}

// OidcAuthorize 浏览器点击第三方登录时访问：生成 state 后跳转到身份提供商，失败时回到登录页显示错误
func (u *UserController) OidcAuthorize(ctx context.Context, c *app.RequestContext) {
	req := &dto.OidcAuthorizeReq{}
	if err := c.Bind(req); err != nil {
		resps.Redirect(c, u.service.OidcErrorPageUrl("/", resps.ErrParamInvalid))
		return
	}
	req.BrowserNonce = ctxutils.EnsureOidcNonce(c)
	req.UserIP = c.ClientIP()
	authorizeUrl, svcerr := u.service.OidcAuthorize(ctx, req)
	if svcerr != nil {
		logrus.WithField("oidc_name", req.Name).Warn("oidc authorize failed: ", svcerr.Error())
		resps.Redirect(c, u.service.OidcErrorPageUrl(req.RedirectBack, svcerr.Message))
		return
	}
	resps.Redirect(c, authorizeUrl)
}

func (u *UserController) GetUserOpenIDList(ctx context.Context, c *app.RequestContext) {
	userOpenIdDtos, svcerr := u.service.ListUserOpenIDs(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{
		"openids": userOpenIdDtos,
	})
}

func (u *UserController) OidcLogin(ctx context.Context, c *app.RequestContext) {
	req := &dto.OidcLoginReq{
		UserIP:       c.ClientIP(),
		BrowserNonce: string(c.Cookie(ctxutils.OidcNonceCookie)),
	}
	if err := c.Bind(req); err != nil {
		resps.Redirect(c, u.service.OidcErrorPageUrl("/", resps.ErrParamInvalid))
		return
	}
	resp, svcerr := u.service.OidcLogin(ctx, req)
	if svcerr != nil {
		// 用户停在浏览器里，回到登录页显示错误，而不是一段 JSON；state 有效时会带回原页面地址
		logrus.WithField("oidc_name", req.Name).Warn("oidc login failed: ", svcerr.Error())
		resps.Redirect(c, u.service.OidcErrorPageUrl(req.RedirectBack, svcerr.Message))
		return
	}
	// 设置Cookie
	if !req.IsBind {
		ctxutils.Set2Tokens(c, resp.Token, resp.RefreshToken)
	}
	// 重定向回前端传来的页面
	resps.Redirect(c, req.RedirectBack)
}

func (u *UserController) DeleteUserOpenID(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if svcerr := u.service.DeleteUserOpenID(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
