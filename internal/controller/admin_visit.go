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

func (cc *AdminController) ListVisits(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListVisitLogReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	logs, total, svcerr := service.NewVisitService().ListVisitLogs(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"visits": logs, "total": total})
}

func (cc *AdminController) GetVisitStats(ctx context.Context, c *app.RequestContext) {
	req := &dto.VisitStatsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	stats, svcerr := service.NewVisitService().GetStats(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, stats)
}

func (cc *AdminController) GetVisitor(ctx context.Context, c *app.RequestContext) {
	visitor, svcerr := service.NewVisitService().GetVisitor(ctx, ctxutils.GetIDParam(c).Uint)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, visitor)
}

func (cc *AdminController) GetVisit(ctx context.Context, c *app.RequestContext) {
	detail, svcerr := service.NewVisitService().GetVisitDetail(ctx, ctxutils.GetIDParam(c).Uint)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, detail)
}

func (cc *AdminController) GetVisitInsights(ctx context.Context, c *app.RequestContext) {
	req := &dto.VisitInsightsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	insights, svcerr := service.NewVisitService().GetInsights(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, insights)
}
