package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

const (
	KeySiteInfo = "site_info"
)

type MiscController struct {
	service *service.MiscService
}

func NewMiscController() *MiscController {
	return &MiscController{
		service: service.NewMiscService(),
	}
}

// GetCacheTags 前端服务端缓存各失效标签的版本号，供前端实例轮询（见 service.CacheTagVersions）
func (mc *MiscController) GetCacheTags(ctx context.Context, c *app.RequestContext) {
	versions, svcerr := service.CacheTagVersions()
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"tags": versions})
}

// GetSiteInfo 前台站点信息：后台保存的整体站点信息补上缺少的注册项，从未保存过时全部按配置注册表的生效值与默认值（见 config.SiteInfo）
func (mc *MiscController) GetSiteInfo(ctx context.Context, c *app.RequestContext) {
	resps.Ok(c, "", mc.service.GetSiteInfo())
}

func (mc *MiscController) GetPublicConfig(ctx context.Context, c *app.RequestContext) {
	result, svcerr := mc.service.GetPublicConfig(c.Query("keys"))
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, "", result)
}

func (mc *MiscController) GetSitemapData(ctx context.Context, c *app.RequestContext) {
	resps.Ok(c, "", mc.service.GetSitemapData(ctx))
}

func (mc *MiscController) GetRssData(ctx context.Context, c *app.RequestContext) {
	data, svcerr := mc.service.GetRssData(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, "", data)
}

// GetMetrics 获取全部后端实例的运行时指标，仅管理员可见
func (mc *MiscController) GetMetrics(ctx context.Context, c *app.RequestContext) {
	resp, svcerr := service.ListRuntimeMetrics()
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, "", resp)
}
