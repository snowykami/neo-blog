package service

import (
	"context"
	"errors"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

type PostService struct{}

func NewPostService() *PostService {
	return &PostService{}
}

func (p *PostService) CreatePost(ctx context.Context, req *dto.CreateOrUpdatePostReq) (uint, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.NewUnauthorized("login_required")
	}
	slug, svcerr := normalizePostSlug(req.Slug)
	if svcerr != nil {
		return 0, svcerr
	}
	labels, err := repo.Label.GetLabelsByIDs(req.LabelIds)
	if err != nil {
		return 0, errs.NewInternalServer("failed_to_get_target")
	}
	categoryID, svcerr := normalizeCategoryID(req.CategoryID)
	if svcerr != nil {
		return 0, svcerr
	}
	post := &model.Post{
		UserID: currentUser.ID,
		PostBase: model.PostBase{
			CategoryID:      categoryID,
			Cover:           utils.Deref(req.Cover),
			BackgroundImage: utils.Deref(req.BackgroundImage),
			Content:         req.Content,
			Description:     utils.Deref(req.Description),
			IsPrivate:       utils.Deref(req.IsPrivate),
			Labels:          labels,
			Slug:            slug,
			Title:           req.Title,
			Top:             utils.Deref(req.Top),
			Type:            req.Type,
		},
	}
	if err := repo.Post.CreatePost(post); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return 0, errs.NewConflict("slug_already_exists")
		}
		return 0, errs.NewInternalServer("failed_to_create_target")
	}
	return post.ID, nil
}

// normalizeSlug 去除首尾空白；纯数字 slug 会与 id 访问冲突，不允许使用
func normalizeSlug(slug string) (string, *errs.ServiceError) {
	slug = strings.TrimSpace(slug)
	if slug != "" && strings.Trim(slug, "0123456789") == "" {
		return "", errs.NewBadRequest("slug_cannot_be_numeric")
	}
	return slug, nil
}

// normalizePostSlug 文章 slug 可选，空字符串存为 NULL，避免多篇无 slug 的文章触发唯一约束
func normalizePostSlug(slug *string) (*string, *errs.ServiceError) {
	if slug == nil {
		return nil, nil
	}
	normalized, svcerr := normalizeSlug(*slug)
	if svcerr != nil || normalized == "" {
		return nil, svcerr
	}
	return &normalized, nil
}

// normalizeCategoryID 前端用 0 表示未分类；分类不存在时返回错误
func normalizeCategoryID(categoryID *uint) (*uint, *errs.ServiceError) {
	if categoryID == nil || *categoryID == 0 {
		return nil, nil
	}
	var count int64
	if err := repo.GetDB().Model(&model.Category{}).Where("id = ?", *categoryID).Count(&count).Error; err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	if count == 0 {
		return nil, errs.NewBadRequest("category_not_found")
	}
	return categoryID, nil
}

func (p *PostService) DeletePost(ctx context.Context, postId uint) *errs.ServiceError {
	if postId == 0 {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	post, err := repo.Post.GetPostByID(postId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errs.NewNotFound("target_not_found")
		}
		return errs.NewInternalServer("failed_to_get_target")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx)) {
		return errs.NewForbidden("permission_denied")
	}
	if err := repo.Post.DeletePost(postId); err != nil {
		return errs.NewInternalServer("failed_to_delete_target")
	}
	if err := repo.Revision.DeleteByTarget(constant.TargetTypePost, postId); err != nil {
		logrus.Warnf("delete revisions of post %d failed: %v", postId, err)
	}
	return nil
}

func (p *PostService) GetPostSlugOrId(ctx context.Context, slugOrId string) (*dto.PostDto, *errs.ServiceError) {
	if slugOrId == "" {
		return nil, errs.NewBadRequest("missing_request_parameters")
	}
	post, err := repo.Post.GetPostBySlugOrID(slugOrId)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found")
	}
	currentUser, userOk := ctxutils.GetCurrentUser(ctx)
	// 私密文章只有自己和管理员能看
	if post.IsPrivate && !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx)) {
		return nil, errs.NewForbidden("permission_denied")
	}
	// 检测用户是否点赞
	postDto := post.ToDto()
	if userOk {
		liked, err := repo.Like.IsLiked(currentUser.ID, post.ID, constant.TargetTypePost)
		if err == nil {
			postDto.IsLiked = liked
		}
	}
	return postDto, nil
}

func (p *PostService) UpdatePost(ctx context.Context, req *dto.CreateOrUpdatePostReq) (uint, *errs.ServiceError) {
	post, err := repo.Post.GetPostByID(req.ID)
	if err != nil {
		return 0, errs.NewNotFound("target_not_found")
	}

	if !(ctxutils.IsAdmin(ctx) || ctxutils.IsOwnerOfTarget(ctx, post.UserID)) {
		return 0, errs.NewForbidden("permission_denied")
	}
	// 保存正文时校验编辑会话，被其他编辑会话顶掉后不能再覆盖正文
	if req.Content != "" || req.DraftContent != nil {
		if svcerr := NewEditSessionService().CheckContentWrite(constant.TargetTypePost, post.ID, req.EditSessionID); svcerr != nil {
			return 0, svcerr
		}
	}
	// 未传的字段保持原值，TOP 可以为 0
	if req.Top != nil {
		post.Top = *req.Top
	}
	utils.UpdateNonEmpty(&post.Title, req.Title)
	utils.UpdateNonEmpty(&post.Type, req.Type)
	utils.UpdateNonEmpty(&post.Content, req.Content)
	if req.Cover != nil {
		post.Cover = *req.Cover
	}
	if req.BackgroundImage != nil {
		post.BackgroundImage = *req.BackgroundImage
	}
	if req.Description != nil {
		post.Description = *req.Description
	}
	utils.UpdatePtrNonZero(&post.DraftContent, req.DraftContent)
	// 传了 slug 才更新，空字符串表示清除 slug
	if req.Slug != nil {
		slug, svcerr := normalizePostSlug(req.Slug)
		if svcerr != nil {
			return 0, svcerr
		}
		post.Slug = slug
	}
	// 传了 category_id 才更新，0 表示取消分类
	if req.CategoryID != nil {
		categoryID, svcerr := normalizeCategoryID(req.CategoryID)
		if svcerr != nil {
			return 0, svcerr
		}
		post.CategoryID = categoryID
		post.Category = nil
	}
	if req.IsPrivate != nil {
		post.IsPrivate = *req.IsPrivate
	}

	// 只有传了 label_ids 才更新标签（传空数组表示清空），只保存草稿时保持原标签
	if req.LabelIds != nil {
		// 跳过不存在的标签
		labels, err := repo.Label.GetLabelsByIDs(req.LabelIds)
		if err != nil {
			return 0, errs.NewInternalServer("failed_to_get_target")
		}
		post.Labels = labels
	}
	if err := repo.Post.SavePost(post); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return 0, errs.NewConflict("slug_already_exists")
		}
		return 0, errs.NewInternalServer("failed_to_update_target")
	}
	// 发布或保存草稿后记录版本历史
	if req.Content != "" || req.DraftContent != nil {
		NewRevisionService().RecordAfterSave(ctx, constant.TargetTypePost, post.ID, req.Content != "", req.EditSessionID)
	}
	return post.ID, nil
}

func (p *PostService) ListPosts(ctx context.Context, req *dto.ListPostReq) ([]*dto.PostDto, int64, *errs.ServiceError) {
	return p.listPosts(ctx, req, false)
}

// ListPostsAdmin 后台管理列出所有文章（包含所有用户的私密文章），仅管理员可用
func (p *PostService) ListPostsAdmin(ctx context.Context, req *dto.ListPostReq) ([]*dto.PostDto, int64, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return nil, 0, errs.NewForbidden("permission_denied")
	}
	return p.listPosts(ctx, req, true)
}

func (p *PostService) listPosts(ctx context.Context, req *dto.ListPostReq, includeAllPrivate bool) ([]*dto.PostDto, int64, *errs.ServiceError) {
	postDtos := make([]*dto.PostDto, 0)
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	queryArray := make([]string, 0)
	if req.Query != "" {
		for _, q := range strings.Split(req.Query, ",") {
			queryArray = append(queryArray, strings.TrimSpace(q))
		}
	}
	posts, total, err := repo.Post.ListPosts(currentUserID, includeAllPrivate, queryArray, req)
	if err != nil {
		return nil, total, errs.NewInternalServer("failed_to_get_target")
	}
	for _, post := range posts {
		postDtos = append(postDtos, post.ToDtoWithShortContent(200))
	}
	// 后台管理列表展示 AI 摘要任务的进行中 / 失败状态
	if includeAllPrivate || currentUserID != 0 {
		NewAISummaryService().FillListStatus(postDtos)
	}
	return postDtos, total, nil
}

// ListCategories 全部文章分类
func (p *PostService) ListCategories() ([]dto.CategoryDto, *errs.ServiceError) {
	categories, err := repo.Post.ListCategories()
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result := make([]dto.CategoryDto, 0, len(categories))
	for i := range categories {
		result = append(result, *categories[i].ToDto())
	}
	return result, nil
}
