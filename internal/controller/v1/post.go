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
	// 检测封面链接,可为空，不为空时才检查
	if req.Cover != "" {
		pass := utils2.Url.IsValidUrl(req.Cover)
		if !pass {
			resps.BadRequest(c, "Cover URL is invalid")
			return
		}
	}
	postID, svcerr := p.service.CreatePost(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": postID})
}

func (p *PostController) Delete(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if svcerr := p.service.DeletePost(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
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
	post, svcerr := p.service.GetPostSlugOrId(ctx, slugOrId)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	if post == nil {
		resps.NotFound(c, resps.ErrNotFound)
		return
	}

	if isDraft {
		// 草稿请求仅允许作者本人或者管理员查看
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

func (p *PostController) GetRandom(ctx context.Context, c *app.RequestContext) {
	var post model.Post
	if err := repo.GetDB().Where("is_private = ?", false).Order("RANDOM()").Limit(1).Find(&post).Error; err != nil {
		resps.InternalServerError(c, err.Error())
		return
	}
	resps.Ok(c, resps.Success, post.ToDto())
}

func (p *PostController) Update(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateOrUpdatePostReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 检测封面链接
	if req.Cover != "" {
		pass := utils2.Url.IsValidUrl(req.Cover)
		if !pass {
			resps.BadRequest(c, "bad_request", "invalid_url")
			return
		}
	}
	postID, svcerr := p.service.UpdatePost(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
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
	posts, total, svcerr := p.service.ListPosts(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"posts": posts, "total": total})
}

func (p *PostController) GetCategories(ctx context.Context, c *app.RequestContext) {
	var categories []model.Category
	err := repo.GetDB().Order("id DESC").Find(&categories).Error
	if err != nil {
		resps.Error(c, errs.NewInternalServer("failed_to_get_target"))
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
		resps.Error(c, errs.NewInternalServer("failed_to_create_target"))
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
		resps.Error(c, errs.NewInternalServer("failed_to_update_target"))
		return
	}
	resps.Ok(c, resps.Success, utils.H{"id": categoryModel.ID})
}

func (p *PostController) DeleteCategory(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if err := repo.GetDB().Delete(&model.Category{}, id).Error; err != nil {
		resps.Error(c, errs.NewInternalServer("failed_to_delete_target"))
		return
	}
	resps.Ok(c, resps.Success, nil)
}
