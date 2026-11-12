package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type SearchController struct {
	service *service.SearchService
}

func NewSearchController() *SearchController {
	return &SearchController{
		service: service.NewSearchService(),
	}
}

func (sc *SearchController) GlobalSearch(ctx context.Context, c *app.RequestContext) {
	req := &dto.GlobalSearchReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	resp, svcerr := sc.service.GlobalSearch(ctx, req, c.ClientIP())
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

// TestMeilisearch 测试 Meilisearch 连接与 API Key 权限（允许带未保存的表单值，不落库）
func (cc *AdminController) TestMeilisearch(ctx context.Context, c *app.RequestContext) {
	req := &dto.TestMeilisearchReq{}
	if len(c.Request.Body()) > 0 {
		if err := c.BindAndValidate(req); err != nil {
			resps.BadRequest(c, resps.ErrParamInvalid)
			return
		}
	}
	resp, svcerr := cc.service.TestMeilisearch(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}

// ReindexSearch 手动触发全站公开搜索索引平滑重建
func (cc *AdminController) ReindexSearch(_ context.Context, c *app.RequestContext) {
	resp, svcerr := cc.service.ReindexSearch()
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, resp)
}
