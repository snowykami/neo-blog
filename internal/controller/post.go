package v1

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"

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
	if req.Cover != nil && *req.Cover != "" {
		pass := utils2.Url.IsValidUrl(*req.Cover)
		if !pass {
			resps.BadRequest(c, "invalid_cover_url")
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

// Get 前台读取文章：只返回公开文章的已发布内容；私密文章对所有人 404，草稿在后台读取（见 GetForEdit）
func (p *PostController) Get(ctx context.Context, c *app.RequestContext) {
	slugOrId := c.Param("slug_or_id") // 此处不用ctxutils bind是因为允许slug string类型
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
	resps.Ok(c, resps.Success, post)
}

// GetStats 公开文章的浏览量、点赞数、评论数：前台文章页的计数是缓存快照，浏览器进入文章页后用它补上最新值
func (p *PostController) GetStats(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	stats, svcerr := p.service.GetPublicPostStats(id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, stats)
}

// GetForEdit 后台编辑器与预览读取文章（含私密文章与草稿），仅作者本人与管理员；路径参数可以是 id 或 slug
func (p *PostController) GetForEdit(ctx context.Context, c *app.RequestContext) {
	slugOrId := c.Param("id")
	if slugOrId == "" {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	post, svcerr := p.service.GetPostForEdit(ctx, slugOrId)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, post)
}

func (p *PostController) GetRandom(ctx context.Context, c *app.RequestContext) {
	// 先只随机取 id，避免对整表正文排序
	var ids []uint
	if err := repo.GetDB().Model(&model.Post{}).Where("is_private = ?", false).Order("RANDOM()").Limit(1).Pluck("id", &ids).Error; err != nil {
		resps.InternalError(c, err)
		return
	}
	var post model.Post
	if len(ids) > 0 {
		if err := repo.GetDB().Omit("draft_content").First(&post, ids[0]).Error; err != nil {
			resps.InternalError(c, err)
			return
		}
	}
	postDto := post.ToDto()
	postDto.DraftContent = nil // 不返回草稿内容
	postDto.DraftVersion = 0
	resps.Ok(c, resps.Success, postDto)
}

func (p *PostController) Update(ctx context.Context, c *app.RequestContext) {
	var req dto.CreateOrUpdatePostReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 检测封面链接
	if req.Cover != nil && *req.Cover != "" {
		pass := utils2.Url.IsValidUrl(*req.Cover)
		if !pass {
			resps.BadRequest(c, "invalid_url")
			return
		}
	}
	// 返回保存后的草稿版本号，编辑页下次保存正文时作为基线版本号
	result, svcerr := p.service.UpdatePost(ctx, &req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

func (p *PostController) List(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListPostReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if !slices.Contains(constant.OrderByEnumPost, req.OrderBy) {
		resps.BadRequest(c, "invalid_order_by")
		return
	}
	posts, total, svcerr := p.service.ListPosts(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resp := utils.H{"posts": posts, "total": total}
	// 首页默认列表另外返回置顶文章（列表中已排除它们），total 不含置顶
	if req.HomeListing() {
		pinned, svcerr := p.service.ListPinnedPosts(ctx)
		if svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		resp["pinned"] = pinned
	}
	resps.Ok(c, resps.Success, resp)
}

// ListMine 后台「我的文章」：当前用户自己的全部文章（含私密文章）
func (p *PostController) ListMine(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListPostReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	if !slices.Contains(constant.OrderByEnumPost, req.OrderBy) {
		resps.BadRequest(c, "invalid_order_by")
		return
	}
	posts, total, svcerr := p.service.ListMyPosts(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"posts": posts, "total": total})
}

// GetPostCards 批量读取正文「文章引用」卡片的数据（ids 逗号分隔），不可见的文章不返回
func (p *PostController) GetPostCards(ctx context.Context, c *app.RequestContext) {
	req := &dto.PostCardReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	ids, ok := parseIDList(req.IDs)
	if !ok {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	cards, svcerr := p.service.ListPostCards(ctx, ids)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"cards": cards})
}

// parseIDList 解析逗号分隔的 id 列表，忽略空项；出现非法项时返回 false
func parseIDList(raw string) ([]uint, bool) {
	ids := make([]uint, 0, 8)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return nil, false
		}
		ids = append(ids, uint(id))
	}
	return ids, true
}

func (p *PostController) GetCategories(ctx context.Context, c *app.RequestContext) {
	var categories []model.Category
	err := repo.GetDB().Order("id DESC").Find(&categories).Error
	if err != nil {
		resps.Error(c, errs.Internal("failed_to_get_target", err).WithResource("category"))
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
		resps.Error(c, categoryWriteError(err, categoryModel, "failed_to_create_target"))
		return
	}
	repo.InvalidatePostCache()
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
		resps.Error(c, categoryWriteError(err, categoryModel, "failed_to_update_target"))
		return
	}
	repo.InvalidatePostCache()
	resps.Ok(c, resps.Success, utils.H{"id": categoryModel.ID})
}

func (p *PostController) DeleteCategory(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	// 分类硬删除并清空文章的分类引用，避免软删除记录占用唯一的名称与 slug
	if err := repo.GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Post{}).Where("category_id = ?", id).UpdateColumn("category_id", nil).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&model.Category{}, id).Error
	}); err != nil {
		resps.Error(c, errs.Internal("failed_to_delete_target", err).WithResource("category"))
		return
	}
	repo.InvalidatePostCache()
	resps.Ok(c, resps.Success, nil)
}

// TriggerAISummary 手动触发 AI 摘要生成任务（后台执行）
func (p *PostController) TriggerAISummary(ctx context.Context, c *app.RequestContext) {
	postID := ctxutils.GetIDParam(c).Uint
	if svcerr := service.NewAISummaryService().Trigger(ctx, postID); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

// BatchAISummary 为全站文章批量创建 AI 摘要任务，跳过已是最新的摘要
func (p *PostController) BatchAISummary(ctx context.Context, c *app.RequestContext) {
	var req dto.BatchAISummaryReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	result, svcerr := service.NewAISummaryService().TriggerAll(ctx, req.OverwriteManual)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, result)
}

// GetAISummaryStatus 查询 AI 摘要生成状态
func (p *PostController) GetAISummaryStatus(ctx context.Context, c *app.RequestContext) {
	postID := ctxutils.GetIDParam(c).Uint
	status, svcerr := service.NewAISummaryService().Status(ctx, postID)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, status)
}

// categoryWriteError 分类的名称与 slug 都唯一：重复时指明是哪个字段，其他错误只写日志
func categoryWriteError(err error, category *model.Category, code string) *errs.ServiceError {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		var count int64
		repo.GetDB().Model(&model.Category{}).Where("slug = ? AND id <> ?", category.Slug, category.ID).Count(&count)
		if count > 0 {
			return errs.AlreadyExists("category", "slug", category.Slug)
		}
		return errs.AlreadyExists("category", "name", category.Name)
	}
	return errs.Internal(code, err).WithResource("category")
}
