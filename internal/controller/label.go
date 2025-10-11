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

type LabelController struct {
	service *service.LabelService
}

func NewLabelController() *LabelController {
	return &LabelController{
		service: service.NewLabelService(),
	}
}

func (l *LabelController) Create(ctx context.Context, c *app.RequestContext) {
	req := &dto.CreateLabelReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	labelID, svcerr := l.service.CreateLabel(req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": labelID})
}

func (l *LabelController) Delete(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	svcerr := l.service.DeleteLabel(id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (l *LabelController) Get(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	label, svcerr := l.service.GetLabelByID(id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	if label == nil {
		resps.NotFound(c, resps.ErrNotFound)
		return
	}
	resps.Ok(c, resps.Success, label)
}

func (l *LabelController) Update(ctx context.Context, c *app.RequestContext) {
	req := &dto.UpdateLabelReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	labelID, svcerr := l.service.UpdateLabel(req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": labelID})
}

func (l *LabelController) List(ctx context.Context, c *app.RequestContext) {
	labels, svcerr := l.service.ListLabels()
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"labels": labels})
}
