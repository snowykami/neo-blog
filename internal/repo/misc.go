package repo

import (
	"context"
	"errors"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

type miscRepo struct{}

var Misc = &miscRepo{}

type SitemapRawData struct {
	Posts            []model.Post
	Editors          []model.User
	Categories       []model.Category
	Pages            []model.Page
	Labels           []model.Label
	FriendsUpdatedAt *time.Time
}

// GetSitemapRaw 查询站点地图所需的公开实体摘要；任一核心查询失败时返回错误，防止把瞬时故障缓存为空站点地图
func (m *miscRepo) GetSitemapRaw(ctx context.Context, limit int) (*SitemapRawData, error) {
	db, cancel := WithTimeout(ctx, DefaultHeavyQueryTimeout)
	defer cancel()
	raw := &SitemapRawData{}

	if err := db.Model(&model.Post{}).
		Select("id, slug, created_at, updated_at").
		Where("is_private = ? AND is_draft = ?", false, false).
		Order("created_at DESC").
		Limit(limit).
		Find(&raw.Posts).Error; err != nil {
		return nil, err
	}

	if err := db.Model(&model.User{}).
		Select("id, username, updated_at").
		Where("role IN ?", []constant.Role{constant.RoleEditor, constant.RoleAdmin}).
		Order("updated_at DESC").
		Limit(limit).
		Find(&raw.Editors).Error; err != nil {
		return nil, err
	}

	if err := db.Model(&model.Category{}).
		Select("id, slug, updated_at").
		Order("updated_at DESC").
		Limit(limit).
		Find(&raw.Categories).Error; err != nil {
		return nil, err
	}

	// 公开的独立页面（链接页面只是导航入口，不列入）
	if err := db.Model(&model.Page{}).
		Select("id, slug, updated_at").
		Where("is_private = ? AND kind <> ?", false, model.PageKindLink).
		Order("updated_at DESC").
		Limit(limit).
		Find(&raw.Pages).Error; err != nil {
		return nil, err
	}

	if err := db.Model(&model.Label{}).
		Select("id, name, slug, updated_at").
		Order("updated_at DESC").
		Limit(limit).
		Find(&raw.Labels).Error; err != nil {
		return nil, err
	}

	// 公开友链分组下最新一条已通过审核友链的更新时间（供 /links 页面写入准确的 lastmod）
	var latestFriend model.FriendLink
	err := db.Model(&model.FriendLink{}).
		Select("friend_links.updated_at").
		Joins("JOIN friend_groups ON friend_groups.id = friend_links.group_id").
		Where("friend_groups.is_public = ? AND friend_links.status = ?", true, model.FriendStatusApproved).
		Order("friend_links.updated_at DESC").
		First(&latestFriend).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err == nil && !latestFriend.UpdatedAt.IsZero() {
		ts := latestFriend.UpdatedAt
		raw.FriendsUpdatedAt = &ts
	}

	return raw, nil
}

// ListPublicPostsForRSS 查询 RSS 订阅源所需的最新公开已发布文章及作者、分类关联（仅摘要模式可跳过大文本正文列）
func (m *miscRepo) ListPublicPostsForRSS(ctx context.Context, limit int, includeContent bool) ([]model.Post, error) {
	var posts []model.Post
	q := GetDB().WithContext(ctx).Model(&model.Post{}).
		Where("is_private = ? AND is_draft = ?", false, false).
		Order("created_at DESC").
		Limit(limit)
	if includeContent {
		q = q.Omit("draft_content")
	} else {
		q = q.Omit("draft_content", "content")
	}
	err := q.Preload("User").
		Preload("Category").
		Find(&posts).Error
	return posts, err
}
