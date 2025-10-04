package v1

import (
	"context"
	"slices"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
	utils2 "github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
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
	isDraft := c.Query("type") == "draft"
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

	if isDraft {
		// 草稿请求仅允许作者本人查看
		if !ctxutils.IsOwnerOfTarget(ctx, post.UserID) && !ctxutils.IsAdmin(ctx) {
			resps.Forbidden(c, resps.ErrForbidden)
			return
		}
		post.DraftContent = utils2.Ternary(post.DraftContent == nil, &post.Content, post.DraftContent)
	} else {
		post.DraftContent = nil // 非草稿请求不返回草稿内容
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

func (p *PostController) GetCategories(ctx context.Context, c *app.RequestContext) {
	var categories []model.Category
	err := repo.GetDB().Find(&categories).Error
	if err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, err.Error(), nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"categories": func() []dto.CategoryDto {
		dtos := make([]dto.CategoryDto, len(categories))
		for i, category := range categories {
			dtos[i] = *category.ToDto()
		}
		return dtos
	}()})
}

func (p *PostController) CreateCategory(ctx context.Context, c *app.RequestContext) {
	var req dto.CategoryDto
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	categoryModel := &model.Category{
		Name:        req.Name,
		Description: req.Description,
		Slug:        req.Slug,
	}
	if err := repo.GetDB().Create(categoryModel).Error; err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": categoryModel.ID})
}

func (p *PostController) UpdateCategory(ctx context.Context, c *app.RequestContext) {
	var req dto.CategoryDto
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	categoryModel := &model.Category{
		Model:       gorm.Model{ID: req.ID},
		Name:        req.Name,
		Description: req.Description,
		Slug:        req.Slug,
	}
	if err := repo.GetDB().Updates(categoryModel).Error; err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, err.Error(), nil)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": categoryModel.ID})
}

func (p *PostController) DeleteCategory(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if err := repo.GetDB().Delete(&model.Category{}, id).Error; err != nil {
		serviceErr := errs.AsServiceError(err)
		resps.Custom(c, serviceErr.Code, serviceErr.Message, nil)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
