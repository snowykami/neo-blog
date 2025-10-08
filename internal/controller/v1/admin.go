package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type AdminController struct {
	service *service.AdminService
}

func NewAdminController() *AdminController {
	return &AdminController{
		service: service.NewAdminService(),
	}
}

func (cc *AdminController) GetDashboard(ctx context.Context, c *app.RequestContext) {
	dashboardData, svcerr := cc.service.GetDashboard()
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, dashboardData)
}

func (cc *AdminController) CreateOidc(ctx context.Context, c *app.RequestContext) {
	var adminCreateOidcReq dto.CreateOidcConfigDto
	if err := c.BindAndValidate(&adminCreateOidcReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	svcerr := cc.service.CreateOidcConfig(&adminCreateOidcReq)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) DeleteOidc(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if id == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}

	svcerr := cc.service.DeleteOidcConfig(id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) GetOidcByID(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if id == 0 {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}

	config, svcerr := cc.service.GetOidcConfigByID(id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, config)
}

func (cc *AdminController) ListOidc(ctx context.Context, c *app.RequestContext) {
	configs, svcerr := cc.service.ListOidcConfigs(false)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, configs)
}

func (cc *AdminController) UpdateOidc(ctx context.Context, c *app.RequestContext) {
	var adminUpdateOidcReq dto.UpdateOidcConfigDto
	if err := c.BindAndValidate(&adminUpdateOidcReq); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	svcerr := cc.service.UpdateOidcConfig(&adminUpdateOidcReq)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
