package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type weatherType struct {
	service *service.WeatherService
}

// Weather 文章内天气卡的数据
var Weather = &weatherType{service: service.NewWeatherService()}

// Current 坐标处的当前天气
func (w *weatherType) Current(ctx context.Context, c *app.RequestContext) {
	var req dto.WeatherReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	weather, svcerr := w.service.GetCurrent(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	// 后端已按坐标缓存，浏览器也可短暂缓存
	c.Response.Header.Set("Cache-Control", "public, max-age=300")
	resps.Ok(c, resps.Success, weather)
}

// Geo 按名称搜索城市
func (w *weatherType) Geo(ctx context.Context, c *app.RequestContext) {
	var req dto.WeatherGeoReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	places, svcerr := w.service.SearchPlaces(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	c.Response.Header.Set("Cache-Control", "public, max-age=3600")
	resps.Ok(c, resps.Success, places)
}
