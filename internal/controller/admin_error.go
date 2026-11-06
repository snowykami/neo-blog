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

func (cc *AdminController) ListErrorIssues(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListErrorIssuesReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	issues, total, svcerr := service.NewErrorReportService().ListIssues(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"issues": issues, "total": total})
}

func (cc *AdminController) GetErrorStats(ctx context.Context, c *app.RequestContext) {
	stats, svcerr := service.NewErrorReportService().GetStats(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, stats)
}

func (cc *AdminController) GetErrorIssue(ctx context.Context, c *app.RequestContext) {
	issue, svcerr := service.NewErrorReportService().GetIssue(ctx, ctxutils.GetIDParam(c).Uint)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, issue)
}

func (cc *AdminController) ListErrorEvents(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListErrorEventsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	events, total, svcerr := service.NewErrorReportService().ListEvents(ctx, ctxutils.GetIDParam(c).Uint, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"events": events, "total": total})
}

func (cc *AdminController) GetErrorEvent(ctx context.Context, c *app.RequestContext) {
	event, svcerr := service.NewErrorReportService().GetEvent(ctx, ctxutils.GetIDParam(c).Uint)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, event)
}

func (cc *AdminController) UpdateErrorIssueStatus(ctx context.Context, c *app.RequestContext) {
	req := &dto.UpdateErrorIssueReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if svcerr := service.NewErrorReportService().UpdateIssueStatus(ctx, ctxutils.GetIDParam(c).Uint, req); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (cc *AdminController) DeleteErrorIssue(ctx context.Context, c *app.RequestContext) {
	if svcerr := service.NewErrorReportService().DeleteIssue(ctx, ctxutils.GetIDParam(c).Uint); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
