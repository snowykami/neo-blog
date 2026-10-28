package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/resps"
)

func (cc *AdminController) ListKV(ctx context.Context, c *app.RequestContext) {
	kvs, err := repo.KV.ListKV(c.Query("query"))
	if err != nil {
		resps.InternalServerError(c, err.Error())
		return
	}
	items := make([]dto.KVDto, 0, len(kvs))
	for _, kv := range kvs {
		items = append(items, dto.KVDto{Key: kv.Key, Value: kv.Value["value"]})
	}
	resps.Ok(c, resps.Success, utils.H{"items": items})
}

// EnvOverrides 由环境变量设置、优先于后台配置的配置项（配置键 → 环境变量中的值），后台据此把这些配置显示为只读
func (cc *AdminController) EnvOverrides(ctx context.Context, c *app.RequestContext) {
	resps.Ok(c, resps.Success, utils.H{"overrides": tools.EnvOverrides()})
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
	if err := repo.KV.SetKV(key, req.Value); err != nil {
		resps.InternalServerError(c, err.Error())
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
	if err := repo.KV.DeleteKV(key); err != nil {
		resps.InternalServerError(c, err.Error())
		return
	}
	resps.Ok(c, resps.Success, nil)
}
