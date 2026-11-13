package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/resps"
)

func (cc *AdminController) ListKV(ctx context.Context, c *app.RequestContext) {
	items, svcerr := cc.service.ListKV(c.Query("query"))
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"items": items})
}

// GetConfig 后台全局配置表单的结构与当前值：每项的类型、名称与说明的 i18n 键、取值范围、数据库中的值与环境变量的值
func (cc *AdminController) GetConfig(ctx context.Context, c *app.RequestContext) {
	resps.Ok(c, resps.Success, cc.service.GetConfigSchema())
}

// SaveConfig 保存后台全局配置（只包含改动的项）
func (cc *AdminController) SaveConfig(ctx context.Context, c *app.RequestContext) {
	var req dto.SaveConfigReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := cc.service.SaveConfig(&req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) SetKV(ctx context.Context, c *app.RequestContext) {
	var req dto.SetKVReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	key := req.Key
	if key == "" {
		key = c.Param("key")
	}
	if key == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := cc.service.SetKV(key, &req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) DeleteKV(ctx context.Context, c *app.RequestContext) {
	key := c.Param("key")
	if key == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := cc.service.DeleteKV(key); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
