package repo

import (
	"context"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

type miscRepo struct{}

var Misc = &miscRepo{}

type SitemapRawData struct {
	Posts      []model.Post
	Editors    []model.User
	Categories []model.Category
	Pages      []model.Page
	Labels     []model.Label
}

// GetSitemapRaw 查询站点地图所需的公开实体摘要，部分子查询失败不中断整体返回
func (m *miscRepo) GetSitemapRaw(ctx context.Context, limit int) *SitemapRawData {
	db := GetDB().WithContext(ctx)
	raw := &SitemapRawData{}

	db.Model(&model.Post{}).
		Select("id, slug, created_at, updated_at").
		Where("is_private = ? AND is_draft = ?", false, false).
		Order("created_at DESC").
		Limit(limit).
		Find(&raw.Posts)

	db.Model(&model.User{}).
		Select("id, username, updated_at").
		Where("role IN ?", []constant.Role{constant.RoleEditor, constant.RoleAdmin}).
		Order("updated_at DESC").
		Limit(limit).
		Find(&raw.Editors)

	db.Model(&model.Category{}).
		Select("id, slug, updated_at").
		Order("updated_at DESC").
		Limit(limit).
		Find(&raw.Categories)

	// 公开的独立页面（链接页面只是导航入口，不列入）
	db.Model(&model.Page{}).
		Select("id, slug, updated_at").
		Where("is_private = ? AND kind <> ?", false, model.PageKindLink).
		Order("updated_at DESC").
		Limit(limit).
		Find(&raw.Pages)

	db.Model(&model.Label{}).
		Select("id, name, slug, updated_at").
		Order("updated_at DESC").
		Limit(limit).
		Find(&raw.Labels)

	return raw
}

// ListPublicPostsForRSS 查询 RSS 订阅源所需的最新公开已发布文章及作者、分类关联
func (m *miscRepo) ListPublicPostsForRSS(ctx context.Context, limit int) ([]model.Post, error) {
	var posts []model.Post
	err := GetDB().WithContext(ctx).Model(&model.Post{}).
		Where("is_private = ? AND is_draft = ?", false, false).
		Order("created_at DESC").
		Limit(limit).
		Omit("draft_content").
		Preload("User").
		Preload("Category").
		Find(&posts).Error
	return posts, err
}
