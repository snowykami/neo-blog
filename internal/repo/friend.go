package repo

import (
	"strings"

	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

type friendRepo struct{}

var Friend = &friendRepo{}

// ListGroups 列出友链分组，按 sort_order 升序、id 升序
func (r *friendRepo) ListGroups(publicOnly bool, slug string) ([]model.FriendGroup, error) {
	var groups []model.FriendGroup
	q := GetDB().Model(&model.FriendGroup{})
	if publicOnly {
		q = q.Where("is_public = ?", true)
	}
	if slug != "" {
		q = q.Where("slug = ?", slug)
	}
	err := q.Order("sort_order ASC, id ASC").Find(&groups).Error
	return groups, err
}

func (r *friendRepo) GetGroup(id uint) (*model.FriendGroup, error) {
	var group model.FriendGroup
	err := GetDB().First(&group, id).Error
	return &group, err
}

func (r *friendRepo) GetGroupBySlug(slug string) (*model.FriendGroup, error) {
	var group model.FriendGroup
	err := GetDB().Where("slug = ?", slug).First(&group).Error
	return &group, err
}

func (r *friendRepo) CreateGroup(group *model.FriendGroup) error {
	return GetDB().Select("*").Create(group).Error
}

func (r *friendRepo) SaveGroup(group *model.FriendGroup) error {
	return GetDB().Save(group).Error
}

func (r *friendRepo) DeleteGroup(id uint) error {
	return GetDB().Delete(&model.FriendGroup{}, id).Error
}

func (r *friendRepo) ReorderGroups(ids []uint) error {
	return GetDB().Transaction(func(tx *gorm.DB) error {
		for i, id := range ids {
			if err := tx.Model(&model.FriendGroup{}).Where("id = ?", id).Update("sort_order", (i+1)*10).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *friendRepo) CountLinksByGroup() (map[uint]int64, error) {
	type row struct {
		GroupID uint
		Count   int64
	}
	var rows []row
	err := GetDB().Model(&model.FriendLink{}).
		Select("group_id, COUNT(*) as count").
		Group("group_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	res := make(map[uint]int64, len(rows))
	for _, item := range rows {
		res[item.GroupID] = item.Count
	}
	return res, nil
}

func (r *friendRepo) CountLinksInGroup(groupID uint) (int64, error) {
	var count int64
	err := GetDB().Model(&model.FriendLink{}).Where("group_id = ?", groupID).Count(&count).Error
	return count, err
}

// ListApprovedByGroupIDs 按分组 ID 集合查询所有已通过审核的友链
func (r *friendRepo) ListApprovedByGroupIDs(groupIDs []uint) ([]model.FriendLink, error) {
	if len(groupIDs) == 0 {
		return []model.FriendLink{}, nil
	}
	var links []model.FriendLink
	err := GetDB().Model(&model.FriendLink{}).
		Where("group_id IN ? AND status = ?", groupIDs, model.FriendStatusApproved).
		Order("sort_order ASC, id ASC").
		Find(&links).Error
	return links, err
}

func (r *friendRepo) ListByUser(userID uint) ([]model.FriendLink, error) {
	var links []model.FriendLink
	err := GetDB().Where("user_id = ?", userID).Order("id DESC").Find(&links).Error
	return links, err
}

func (r *friendRepo) CountByUser(userID uint) (int64, error) {
	var count int64
	err := GetDB().Model(&model.FriendLink{}).Where("user_id = ?", userID).Count(&count).Error
	return count, err
}

func (r *friendRepo) GetLink(id uint) (*model.FriendLink, error) {
	var link model.FriendLink
	err := GetDB().Preload("User").First(&link, id).Error
	return &link, err
}

func (r *friendRepo) GetByNormalizedHost(host string) (*model.FriendLink, error) {
	var link model.FriendLink
	err := GetDB().Where("normalized_host = ?", host).First(&link).Error
	return &link, err
}

func (r *friendRepo) CreateLink(link *model.FriendLink) error {
	return GetDB().Create(link).Error
}

func (r *friendRepo) SaveLink(link *model.FriendLink) error {
	return GetDB().Omit("User").Save(link).Error
}

func (r *friendRepo) UpdateLinkColumns(id uint, updates map[string]any) error {
	return GetDB().Model(&model.FriendLink{}).Where("id = ?", id).Updates(updates).Error
}

func (r *friendRepo) DeleteLink(id uint) error {
	return GetDB().Delete(&model.FriendLink{}, id).Error
}

func (r *friendRepo) CountPendingReviews() (int64, error) {
	var count int64
	err := GetDB().Model(&model.FriendLink{}).
		Where("status IN ?", []string{model.FriendStatusPending, model.FriendStatusPreApproved}).
		Count(&count).Error
	return count, err
}

func (r *friendRepo) ListAdminLinks(page, pageSize int, status string, groupID uint, keyword string) ([]model.FriendLink, int64, error) {
	q := GetDB().Model(&model.FriendLink{})
	if status != "" && status != "all" {
		q = q.Where("status = ?", status)
	}
	if groupID > 0 {
		q = q.Where("group_id = ?", groupID)
	}
	if kw := strings.TrimSpace(keyword); kw != "" {
		like := "%" + kw + "%"
		q = q.Where("name LIKE ? OR url LIKE ? OR description LIKE ?", like, like, like)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var links []model.FriendLink
	offset := (page - 1) * pageSize
	err := q.Preload("User").
		Order("CASE status WHEN 'pre_approved' THEN 0 WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END ASC, sort_order ASC, id DESC").
		Offset(offset).
		Limit(pageSize).
		Find(&links).Error
	return links, total, err
}

func (r *friendRepo) ListAllForProbe(onlyApproved bool) ([]model.FriendLink, error) {
	var links []model.FriendLink
	q := GetDB().Model(&model.FriendLink{})
	if onlyApproved {
		q = q.Where("status = ?", model.FriendStatusApproved)
	} else {
		q = q.Where("status IN ?", []string{model.FriendStatusApproved, model.FriendStatusPreApproved})
	}
	err := q.Order("id ASC").Find(&links).Error
	return links, err
}

func (r *friendRepo) ListPendingLinks(limit int) ([]model.FriendLink, error) {
	var links []model.FriendLink
	err := GetDB().Where("status = ?", model.FriendStatusPending).
		Order("id ASC").
		Limit(limit).
		Find(&links).Error
	return links, err
}

// seedDefaultFriendGroups 首次启动且表中无任何分组时初始化默认预设分组
func seedDefaultFriendGroups() error {
	var count int64
	if err := GetDB().Model(&model.FriendGroup{}).Count(&count).Error; err != nil || count > 0 {
		return err
	}
	groups := make([]model.FriendGroup, len(model.DefaultFriendGroups))
	copy(groups, model.DefaultFriendGroups)
	return GetDB().Create(&groups).Error
}
