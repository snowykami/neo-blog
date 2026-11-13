package v1

import (
	"context"
	"fmt"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/resps"
)

func hasKVValue(v any) bool {
	if v == nil {
		return false
	}
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s) != ""
	}
	return strings.TrimSpace(fmt.Sprint(v)) != ""
}

func (cc *AdminController) ListKV(ctx context.Context, c *app.RequestContext) {
	kvs, err := repo.KV.ListKV(c.Query("query"))
	if err != nil {
		resps.InternalError(c, err)
		return
	}
	items := make([]dto.KVDto, 0, len(kvs))
	for _, kv := range kvs {
		rawVal := kv.Value["value"]
		if kv.Secret || config.IsSecretKey(kv.Key) {
			items = append(items, dto.KVDto{
				Key:      kv.Key,
				Value:    nil,
				Secret:   true,
				HasValue: hasKVValue(rawVal),
			})
			continue
		}
		items = append(items, dto.KVDto{Key: kv.Key, Value: rawVal})
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
	updateValue := req.UpdateValue == nil || *req.UpdateValue
	secret := req.Secret
	if secret == nil && config.IsSecretKey(key) {
		isSecret := true
		secret = &isSecret
	}
	if err := repo.KV.SetKVWithSecret(key, req.Value, updateValue, secret); err != nil {
		resps.InternalError(c, err)
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
		resps.InternalError(c, err)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
