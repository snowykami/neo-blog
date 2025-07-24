package v1

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/errs"
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

func (cc *AdminController) CreateOidc(ctx context.Context, c *app.RequestContext) {
	var adminCreateOidcReq dto.AdminOidcConfigDto
	if err := c.BindAndValidate(&adminCreateOidcReq); err != nil {
		c.JSON(400, map[string]string{"error": "Invalid parameters"})
		return
	}
	err := cc.service.CreateOidcConfig(&adminCreateOidcReq)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) DeleteOidc(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	if id == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}

	err := cc.service.DeleteOidcConfig(id)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) GetOidcByID(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	if id == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}

	config, err := cc.service.GetOidcConfigByID(id)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, config)
}

func (cc *AdminController) ListOidc(ctx context.Context, c *app.RequestContext) {
	configs, err := cc.service.ListOidcConfigs(false)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, configs)
}

func (cc *AdminController) UpdateOidc(ctx context.Context, c *app.RequestContext) {
	var adminUpdateOidcReq dto.AdminOidcConfigDto
	if err := c.BindAndValidate(&adminUpdateOidcReq); err != nil {
		c.JSON(400, map[string]string{"error": "Invalid parameters"})
		return
	}
	err := cc.service.UpdateOidcConfig(&adminUpdateOidcReq)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
