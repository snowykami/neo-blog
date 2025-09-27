package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/errs"
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
	var req dto.LabelDto
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	labelID, err := l.service.CreateLabel(&req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": labelID})
}

func (l *LabelController) Delete(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	err := l.service.DeleteLabel(id)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, err.Error(), nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (l *LabelController) Get(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	label, err := l.service.GetLabelByID(id)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	if label == nil {
		resps.NotFound(c, resps.ErrNotFound)
		return
	}
	resps.Ok(c, resps.Success, label)
}

func (l *LabelController) Update(ctx context.Context, c *app.RequestContext) {
	req := &dto.LabelDto{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	labelID, err := l.service.UpdateLabel(req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": labelID})
}

func (l *LabelController) List(ctx context.Context, c *app.RequestContext) {
	labels, err := l.service.ListLabels()
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Error(), nil)
		return
	}
	resps.Ok(c, resps.Success, labels)
}
