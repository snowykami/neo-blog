package repo

import (
	"errors"
	"fmt"
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

// DeletePage 软删除页面，同时清理评论与点赞，并释放 slug 以便新页面复用
func (p *pageRepo) DeletePage(id uint) error {
	return GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Page{}).Where("id = ?", id).
			UpdateColumn("slug", gorm.Expr("? || slug", fmt.Sprintf("deleted-%d-", id))).Error; err != nil {
			return err
		}
		if err := deleteTargetComments(tx, constant.TargetTypePage, id); err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&model.Page{}).Error
	})
}

// GetPageMeta 只读取权限判断需要的字段
func (p *pageRepo) GetPageMeta(id uint) (*PostMeta, error) {
	var meta PostMeta
	if err := GetDB().Model(&model.Page{}).Select("id, user_id, is_private").Where("id = ?", id).Take(&meta).Error; err != nil {
		return nil, err
	}
	return &meta, nil
}

// GetPageByID 按 id 查询页面，内部流程使用，避免纯数字 slug 遮蔽同数字 id 的页面
func (p *pageRepo) GetPageByID(id uint) (*model.Page, error) {
	var page model.Page
	if err := GetDB().Preload(clause.Associations).First(&page, id).Error; err != nil {
		return nil, err
	}
	return &page, nil
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

	req.OrderBy = AllowedOrderBy(req.OrderBy, constant.OrderByEnumPage, constant.OrderByCreatedAt)
	return PaginateQuery[model.Page](q, req.Page, req.Size, req.OrderBy, req.Desc)
}

// ListPublicContentsWithComponents 公开页面（不含私密与草稿）中带内容组件的正文，用于找出页面引用的网易云歌曲（见 service/music_whitelist.go）
func (p *pageRepo) ListPublicContentsWithComponents() ([]string, error) {
	var contents []string
	err := GetDB().Model(&model.Page{}).Where("is_private = ? AND content LIKE ?", false, "%data-component%").Pluck("content", &contents).Error
	return contents, err
}
