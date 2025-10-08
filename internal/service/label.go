package service

import (
	"errors"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

type LabelService struct{}

func NewLabelService() *LabelService {
	return &LabelService{}
}

func (l *LabelService) CreateLabel(req *dto.CreateLabelReq) (uint, *errs.ServiceError) {
	label := &model.Label{
		Name:              req.Name,
		TailwindClassName: req.TailwindClassName,
		Slug:              req.Slug,
	}
	err := repo.Label.CreateLabel(label)
	if err != nil {
		return 0, errs.NewInternalServer("failed_to_create_target")
	}
	return label.ID, nil
}

func (l *LabelService) UpdateLabel(req *dto.UpdateLabelReq) (uint, *errs.ServiceError) {
	label := &model.Label{
		Model:             gorm.Model{ID: req.ID},
		Name:              req.Name,
		TailwindClassName: req.TailwindClassName,
		Slug:              req.Slug,
	}
	err := repo.Label.UpdateLabel(label)
	if err != nil {
		return 0, errs.NewInternalServer("failed_to_update_target")
	}
	return label.ID, nil
}

func (l *LabelService) DeleteLabel(id uint) *errs.ServiceError {
	err := repo.Label.DeleteLabel(id)
	if err != nil {
		return errs.NewInternalServer("failed_to_delete_target")
	}
	return nil
}

func (l *LabelService) GetLabelByID(id uint) (*dto.LabelDto, *errs.ServiceError) {
	label, err := repo.Label.GetLabelByID(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("target_not_found")
		}
		return nil, errs.NewInternalServer("failed_to_get_target")
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
		return labelDtos, errs.NewInternalServer("failed_to_list_targets")
	}
	for _, label := range labels {
		labelDtos = append(labelDtos, label.ToDto())
	}
	return labelDtos, nil
}
