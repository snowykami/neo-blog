package service

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"gorm.io/gorm"
)

type LabelService struct{}

func NewLabelService() *LabelService {
	return &LabelService{}
}

func (l *LabelService) CreateLabel(req *dto.LabelDto) (uint, error) {
	label := &model.Label{
		Value:             req.Value,
		TailwindClassName: req.TailwindClassName,
	}
	return label.ID, repo.Label.CreateLabel(label)
}

func (l *LabelService) UpdateLabel(req *dto.LabelDto) (uint, error) {
	label := &model.Label{
		Model:             gorm.Model{ID: req.ID},
		Value:             req.Value,
		TailwindClassName: req.TailwindClassName,
	}
	return label.ID, repo.Label.UpdateLabel(label)
}

func (l *LabelService) DeleteLabel(id string) error {
	return repo.Label.DeleteLabel(id)
}

func (l *LabelService) GetLabelByID(id string) (*dto.LabelDto, error) {
	label, err := repo.Label.GetLabelByID(id)
	if err != nil {
		return nil, err
	}
	return &dto.LabelDto{
		ID:                label.ID,
		Value:             label.Value,
		TailwindClassName: label.TailwindClassName,
	}, nil
}

func (l *LabelService) ListLabels() ([]dto.LabelDto, error) {
	labels, err := repo.Label.ListLabels()
	var labelDtos []dto.LabelDto
	if err != nil {
		return labelDtos, err
	}
	for _, label := range labels {
		labelDtos = append(labelDtos, dto.LabelDto{
			ID:                label.ID,
			Value:             label.Value,
			TailwindClassName: label.TailwindClassName,
		})
	}
	return labelDtos, nil
}
