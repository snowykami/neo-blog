package repo

import (
	"errors"
	"strconv"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type pageRepo struct{}

var Page = &pageRepo{}

func (p *pageRepo) CreatePage(page *model.Page) error {
	return GetDB().Create(page).Error
}

func (p *pageRepo) DeletePage(id uint) error {
	return GetDB().Where("id = ?", id).Delete(&model.Page{}).Error
}

func (p *pageRepo) GetPageBySlugOrID(slugOrID string) (*model.Page, error) {
	var page model.Page
	if err := GetDB().Where("slug = ?", slugOrID).Preload(clause.Associations).First(&page).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		id, perr := strconv.ParseUint(slugOrID, 10, 64)
		if perr != nil {
			return nil, err
		}
		if err := GetDB().Preload(clause.Associations).First(&page, uint(id)).Error; err != nil {
			return nil, err
		}
	}
	return &page, nil
}

func (p *pageRepo) SavePage(page *model.Page) error {
	if page.ID == 0 {
		return errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	return GetDB().Save(page).Error
}

func (p *pageRepo) ListPages(currentUserID uint, req *dto.ListPageReq, query []string) ([]model.Page, int64, error) {
	q := GetDB().Model(&model.Page{}).Preload(clause.Associations)

	if req.UserID > 0 {
		q = q.Where("user_id = ?", req.UserID)
	}
	if req.OnlyNav {
		q = q.Where("show_in_nav = ?", true)
	}
	if currentUserID > 0 {
		q = q.Where("is_private = ? OR (is_private = ? AND user_id = ?)", false, true, currentUserID)
	} else {
		q = q.Where("is_private = ?", false)
	}
	for _, item := range query {
		if item != "" {
			q = q.Where("title LIKE ? OR content LIKE ? OR description LIKE ?", "%"+item+"%", "%"+item+"%", "%"+item+"%")
		}
	}
	if req.NoContent {
		q = q.Omit("content", "draft_content")
	}

	if req.OrderBy == "" {
		req.OrderBy = constant.OrderByCreatedAt
	}
	return PaginateQuery[model.Page](q, req.Page, req.Size, req.OrderBy, req.Desc)
}
