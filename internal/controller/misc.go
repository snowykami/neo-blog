package v1

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/dto"
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
	data, svcerr := mc.service.GetSitemapData(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, "", data)
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

// GetIndexNowKey 校验并返回 IndexNow 根验证密钥文本（供前端 /<key>.txt 转发调用）
func (mc *MiscController) GetIndexNowKey(ctx context.Context, c *app.RequestContext) {
	matchedKey, ok := mc.service.VerifyIndexNowKey(c.Query("key"))
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(matchedKey))
}

// GetMisskeyFeed 读取共享缓存中的侧边栏 Misskey 公开动态（纯只读缓存切片，不阻塞请求上游）
func (mc *MiscController) GetMisskeyFeed(ctx context.Context, c *app.RequestContext) {
	var req dto.MisskeyFeedQueryReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	feed, svcerr := service.GetMisskeyFeed(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, "", feed)
}
