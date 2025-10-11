package v1

import (
	"context"
	"errors"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
	"gorm.io/gorm"
)

func (u *UserController) GetOidcConfigList(ctx context.Context, c *app.RequestContext) {
	oidcConfigs, svcerr := u.service.ListOidcConfigs()
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, oidcConfigs)
}

func (u *UserController) GetUserOpenIDList(ctx context.Context, c *app.RequestContext) {
	userID, ok := ctxutils.GetCurrentUserID(ctx)
	if !ok {
		resps.Unauthorized(c, resps.ErrUnauthorized)
		return
	}
	userOpenIdModels, err := repo.User.ListUserOpenIDsByUserID(userID)
	if err != nil {
		resps.Error(c, errs.NewInternalServer(err.Error()))
		return
	}
	userOpenIdDtos := model.ToOpenIdDtos(userOpenIdModels)
	resps.Ok(c, resps.Success, utils.H{
		"openids": userOpenIdDtos,
	})
}

func (u *UserController) OidcLogin(ctx context.Context, c *app.RequestContext) {
	req := &dto.OidcLoginReq{
		UserIP: c.ClientIP(),
	}
	if err := c.Bind(req); err != nil {
		resps.BadRequest(c, err.Error())
		return
	}
	resp, svcerr := u.service.OidcLogin(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
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
	if id == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 检查该OIDC是否属于当前用户
	userOpenIdModel, err := repo.User.GetUserOpenIDByID(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			resps.BadRequest(c, resps.ErrNotFound)
			return
		}
		resps.Error(c, errs.NewInternalServer(err.Error()))
		return
	}
	if !ctxutils.IsOwnerOfTarget(ctx, userOpenIdModel.UserID) {
		resps.Forbidden(c, resps.ErrForbidden)
		return
	}
	err = repo.User.DeleteUserOpenID(id)
	if err != nil {
		resps.Error(c, errs.NewInternalServer(err.Error()))
		return
	}
	resps.Ok(c, resps.Success, nil)
}
