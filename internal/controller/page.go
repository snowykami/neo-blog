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

func (p *pageType) Get(ctx context.Context, c *app.RequestContext) {
	slugOrID := c.Param("slug_or_id")
	if slugOrID == "" {
		slugOrID = c.Param("id")
	}
	isDraft := c.Query("type") == "draft"
	page, svcerr := p.service.GetPageSlugOrID(ctx, slugOrID)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	if isDraft {
		if !(ctxutils.IsOwnerOfTarget(ctx, page.UserID) || ctxutils.IsAdmin(ctx)) {
			resps.Forbidden(c, resps.ErrForbidden)
			return
		}
		if page.DraftContent == nil {
			page.DraftContent = &page.Content
		}
	} else {
		page.DraftContent = nil
	}
	resps.Ok(c, resps.Success, page)
}

func (p *pageType) Update(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateOrUpdatePageReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	pageID, svcerr := p.service.UpdatePage(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": pageID})
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
