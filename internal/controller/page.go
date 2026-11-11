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

type pageType struct {
	service *service.PageService
}

var Page = &pageType{service: service.NewPageService()}

func (p *pageType) Create(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateOrUpdatePageReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	pageID, svcerr := p.service.CreatePage(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": pageID})
}

func (p *pageType) Delete(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if svcerr := p.service.DeletePage(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

// Get 前台读取页面：只返回公开页面的已发布内容，私密页面与不存在的页面一律 404；草稿只在后台接口（GetForEdit）返回
func (p *pageType) Get(ctx context.Context, c *app.RequestContext) {
	slugOrID := c.Param("slug_or_id")
	if slugOrID == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	page, svcerr := p.service.GetPageSlugOrID(ctx, slugOrID)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, page)
}

// GetForEdit 后台编辑器与预览读取页面（含私密页面与草稿），仅作者本人与管理员；路径参数可以是 id 或 slug
func (p *pageType) GetForEdit(ctx context.Context, c *app.RequestContext) {
	slugOrID := c.Param("id")
	if slugOrID == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	page, svcerr := p.service.GetPageForEdit(ctx, slugOrID)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, page)
}

func (p *pageType) Update(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateOrUpdatePageReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 返回保存后的草稿版本号，编辑页下次保存正文时作为基线版本号
	result, svcerr := p.service.UpdatePage(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

func (p *pageType) List(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListPageReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	pages, total, svcerr := p.service.ListPages(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"pages": pages, "total": total})
}

// ListMine 后台「我的页面」：当前用户自己的全部页面（含私密页面）
func (p *pageType) ListMine(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListPageReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	pages, total, svcerr := p.service.ListMyPages(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"pages": pages, "total": total})
}
