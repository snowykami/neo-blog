package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

func (cc *AdminController) ListUsers(ctx context.Context, c *app.RequestContext) {
	req := &dto.AdminListUsersReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	users, total, svcerr := service.NewAdminUserService().ListUsers(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"users": users, "total": total})
}

func (cc *AdminController) GetUser(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if id == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := service.NewAdminUserService().GetUserDetail(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

func (cc *AdminController) CreateUser(ctx context.Context, c *app.RequestContext) {
	var req dto.AdminCreateUserReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	user, svcerr := service.NewAdminUserService().CreateUser(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, user)
}

func (cc *AdminController) UpdateUser(ctx context.Context, c *app.RequestContext) {
	var req dto.AdminUpdateUserReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := service.NewAdminUserService().UpdateUser(ctx, &req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) UpdateUserRole(ctx context.Context, c *app.RequestContext) {
	var req dto.AdminUpdateUserRoleReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := service.NewAdminUserService().UpdateUserRole(ctx, &req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) UpdateUserStatus(ctx context.Context, c *app.RequestContext) {
	var req dto.AdminUpdateUserStatusReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := service.NewAdminUserService().UpdateUserStatus(ctx, &req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) ResetUserPassword(ctx context.Context, c *app.RequestContext) {
	var req dto.AdminResetUserPasswordReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := service.NewAdminUserService().ResetUserPassword(ctx, &req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) DeleteUser(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if id == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := service.NewAdminUserService().DeleteUser(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
