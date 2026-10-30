package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type APITokenController struct {
	service *service.APITokenService
}

func NewAPITokenController() *APITokenController {
	return &APITokenController{service: service.NewAPITokenService()}
}

func (a *APITokenController) List(ctx context.Context, c *app.RequestContext) {
	result, svcerr := a.service.List(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

func (a *APITokenController) Create(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateAPITokenReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	result, svcerr := a.service.Create(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

func (a *APITokenController) Revoke(ctx context.Context, c *app.RequestContext) {
	if svcerr := a.service.Revoke(ctx, ctxutils.GetIDParam(c).Uint); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
