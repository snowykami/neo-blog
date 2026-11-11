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

// LabelService 标签是全站共享的：编辑者写文章时可以新建标签，改名与删除会影响其他作者的文章，只有管理员可以
type LabelService struct{}

func NewLabelService() *LabelService {
	return &LabelService{}
}

func (l *LabelService) CreateLabel(ctx context.Context, req *dto.CreateLabelReq) (uint, *errs.ServiceError) {
	if !canCreateTaxonomy(ctx) {
		return 0, errs.NewForbidden("permission_denied")
	}
	label := &model.Label{
		Name:              req.Name,
		TailwindClassName: req.TailwindClassName,
		Slug:              req.Slug,
	}
	if err := repo.Label.CreateLabel(label); err != nil {
		return 0, labelWriteError(err, label, "failed_to_create_target")
	}
	return label.ID, nil
}

func (l *LabelService) UpdateLabel(ctx context.Context, req *dto.UpdateLabelReq) (uint, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return 0, errs.NewForbidden("permission_denied")
	}
	if svcerr := ensureLabelExists(req.ID); svcerr != nil {
		return 0, svcerr
	}
	label := &model.Label{
		Model:             gorm.Model{ID: req.ID},
		Name:              req.Name,
		TailwindClassName: req.TailwindClassName,
		Slug:              req.Slug,
	}
	if err := repo.Label.UpdateLabel(label); err != nil {
		return 0, labelWriteError(err, label, "failed_to_update_target")
	}
	return label.ID, nil
}

// DeleteLabel 硬删除标签并解除与文章的关联
func (l *LabelService) DeleteLabel(ctx context.Context, id uint) *errs.ServiceError {
	if !ctxutils.IsAdmin(ctx) {
		return errs.NewForbidden("permission_denied")
	}
	if svcerr := ensureLabelExists(id); svcerr != nil {
		return svcerr
	}
	err := repo.Label.DeleteLabel(id)
	if err != nil {
		return errs.Internal("failed_to_delete_target", err).WithResource("label")
	}
	return nil
}

func (l *LabelService) GetLabelByID(id uint) (*dto.LabelDto, *errs.ServiceError) {
	label, err := repo.Label.GetLabelByID(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found").WithResource("label")
		}
		return nil, errs.Internal("failed_to_get_target", err).WithResource("label")
	}
	return &dto.LabelDto{
		ID: label.ID,
		LabelBase: dto.LabelBase{
			Name:              label.Name,
			TailwindClassName: label.TailwindClassName,
		},
	}, nil
}

func (l *LabelService) ListLabels() ([]dto.LabelDto, *errs.ServiceError) {
	labels, err := repo.Label.ListLabels()
	var labelDtos []dto.LabelDto
	if err != nil {
		return labelDtos, errs.Internal("failed_to_list_targets", err)
	}
	for _, label := range labels {
		labelDtos = append(labelDtos, label.ToDto())
	}
	return labelDtos, nil
}

func ensureLabelExists(id uint) *errs.ServiceError {
	if id == 0 {
		return errs.NewNotFound("target_not_found").WithResource("label")
	}
	if _, err := repo.Label.GetLabelByID(id); err != nil {
		return errs.FromDB(err, "label", "failed_to_get_target")
	}
	return nil
}

// labelWriteError 标签的 slug 唯一：重复时指明是哪个 slug，其他错误只写日志
func labelWriteError(err error, label *model.Label, code string) *errs.ServiceError {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return errs.AlreadyExists("label", "slug", label.Slug)
	}
	return errs.Internal(code, err).WithResource("label")
}
