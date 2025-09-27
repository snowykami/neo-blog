package v1

import (
	"context"
	"slices"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
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
		return
	}
	postID, err := p.service.CreatePost(ctx, &req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": postID})
}

func (p *PostController) Delete(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if err := p.service.DeletePost(ctx, id); err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

func (p *PostController) Get(ctx context.Context, c *app.RequestContext) {
	slugOrId := c.Param("slug_or_id") // 此处不用ctxutils bind是因为允许slug string类型
	if slugOrId == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 支持slug
	post, err := p.service.GetPostSlugOrId(ctx, slugOrId)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	if post == nil {
		resps.NotFound(c, resps.ErrNotFound)
		return
	}
	resps.Ok(c, resps.Success, post)
}

func (p *PostController) Update(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateOrUpdatePostReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	id := ctxutils.GetIDParam(c).Uint
	postID, err := p.service.UpdatePost(ctx, id, &req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": postID})
}

func (p *PostController) List(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListPostReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if !slices.Contains(constant.OrderByEnumPost, req.OrderBy) {
		resps.BadRequest(c, "无效的排序字段")
		return
	}
	posts, total, err := p.service.ListPosts(ctx, req)
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"posts": posts, "total": total})
}
