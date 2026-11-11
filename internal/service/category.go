package service

import (
	"context"
	"errors"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

// CategoryService 文章分类的写操作。分类是全站共享的：编辑者写文章时可以新建分类，
// 改名与删除会影响其他作者的文章，只有管理员可以
type CategoryService struct{}

func NewCategoryService() *CategoryService {
	return &CategoryService{}
}

// canCreateTaxonomy 新建分类 / 标签：编辑者及以上
func canCreateTaxonomy(ctx context.Context) bool {
	return ctxutils.IsAdmin(ctx) || ctxutils.IsEditor(ctx)
}

func (s *CategoryService) CreateCategory(ctx context.Context, req *dto.CategoryDto) (uint, *errs.ServiceError) {
	if !canCreateTaxonomy(ctx) {
		return 0, errs.NewForbidden("permission_denied")
	}
	category := &model.Category{
		Name:        req.Name,
		Description: req.Description,
		Slug:        req.Slug,
	}
	if err := repo.Category.Create(category); err != nil {
		return 0, categoryWriteError(err, category, "failed_to_create_target")
	}
	repo.InvalidatePostCache()
	return category.ID, nil
}

func (s *CategoryService) UpdateCategory(ctx context.Context, req *dto.CategoryDto) (uint, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return 0, errs.NewForbidden("permission_denied")
	}
	if svcerr := ensureCategoryExists(req.ID); svcerr != nil {
		return 0, svcerr
	}
	category := &model.Category{
		Model:       gorm.Model{ID: req.ID},
		Name:        req.Name,
		Description: req.Description,
		Slug:        req.Slug,
	}
	if err := repo.Category.Update(category); err != nil {
		return 0, categoryWriteError(err, category, "failed_to_update_target")
	}
	repo.InvalidatePostCache()
	return category.ID, nil
}

// DeleteCategory 硬删除分类，原属该分类的文章变为未分类
func (s *CategoryService) DeleteCategory(ctx context.Context, id uint) *errs.ServiceError {
	if !ctxutils.IsAdmin(ctx) {
		return errs.NewForbidden("permission_denied")
	}
	if svcerr := ensureCategoryExists(id); svcerr != nil {
		return svcerr
	}
	if err := repo.Category.Delete(id); err != nil {
		return errs.Internal("failed_to_delete_target", err).WithResource("category")
	}
	repo.InvalidatePostCache()
	return nil
}

func ensureCategoryExists(id uint) *errs.ServiceError {
	if id == 0 {
		return errs.NewNotFound("target_not_found").WithResource("category")
	}
	if _, err := repo.Category.GetByID(id); err != nil {
		return errs.FromDB(err, "category", "failed_to_get_target")
	}
	return nil
}

// categoryWriteError 分类的名称与 slug 都唯一：重复时指明是哪个字段，其他错误只写日志
func categoryWriteError(err error, category *model.Category, code string) *errs.ServiceError {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		if taken, _ := repo.Category.SlugTakenByOther(category.Slug, category.ID); taken {
			return errs.AlreadyExists("category", "slug", category.Slug)
		}
		return errs.AlreadyExists("category", "name", category.Name)
	}
	return errs.Internal(code, err).WithResource("category")
}
