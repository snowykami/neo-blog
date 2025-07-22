package v1

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type PostController struct {
	service *service.PostService
}

func NewPostController() *PostController {
	return &PostController{
		service: service.NewPostService(),
	}
}

func (p *PostController) Create(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateOrUpdatePostReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
	}
	if err := p.service.CreatePost(&req); err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (p *PostController) Delete(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	if id == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if err := p.service.DeletePost(ctx, id); err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (p *PostController) Get(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (p *PostController) Update(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}

func (p *PostController) List(ctx context.Context, c *app.RequestContext) {
	// TODO: Impl
}
