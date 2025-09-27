package repo

import (
	"errors"
	"net/http"
	"slices"
	"strconv"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

type postRepo struct{}

var Post = &postRepo{}

func (p *postRepo) CreatePost(post *model.Post) error {
	if err := GetDB().Create(post).Error; err != nil {
		return err
	}
	return nil
}

func (p *postRepo) DeletePost(id string) error {
	if id == "" {
		return errs.New(http.StatusBadRequest, "invalid post ID", nil)
	}
	if err := GetDB().Where("id = ?", id).Delete(&model.Post{}).Error; err != nil {
		return err
	}
	return nil
}

func (p *postRepo) GetPostBySlugOrID(slugOrId string) (*model.Post, error) {
	var post model.Post

	// 先按 slug 查找（优先）
	if err := GetDB().Where("slug = ?", slugOrId).Preload("User").First(&post).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		// slug 未命中，尝试当作 id
		id, perr := strconv.ParseUint(slugOrId, 10, 64)
		if perr != nil {
			// 既不是存在的 slug，也不是合法 id
			return nil, err
		}
		if err := GetDB().Preload("User").First(&post, uint(id)).Error; err != nil {
			return nil, err
		}
	}

	// 原子地增加 view_count
	if err := GetDB().Model(&model.Post{}).Where("id = ?", post.ID).
		UpdateColumn("view_count", gorm.Expr("view_count + ?", 1)).Error; err != nil {
		return nil, err
	}

	// 重新加载（包含 User），以获取更新后的 view_count 用于计算 heat
	if err := GetDB().Preload("User").First(&post, post.ID).Error; err != nil {
		return nil, err
	}

	// 更新 heat 列
	if err := GetDB().Model(&model.Post{}).Where("id = ?", post.ID).
		UpdateColumn("heat", post.CalculateHeat()).Error; err != nil {
		return nil, err
	}

	// TODO: 对用户进行追踪，实现更真实的访问次数计算，目前粗略地每次访问都+1
	return &post, nil
}

func (p *postRepo) UpdatePost(post *model.Post) error {
	if post.ID == 0 {
		return errs.New(http.StatusBadRequest, "invalid post ID", nil)
	}
	if err := GetDB().Save(post).Error; err != nil {
		return err
	}
	return nil
}

func (p *postRepo) ListPosts(currentUserID uint, keywords []string, labels []dto.LabelDto, labelRule string, page, size uint64, orderBy string, desc bool) ([]model.Post, int64, error) {
	if !slices.Contains(constant.OrderByEnumPost, orderBy) {
		return nil, 0, errs.New(http.StatusBadRequest, "invalid order_by parameter", nil)
	}
	query := GetDB().Model(&model.Post{}).Preload("User")
	if currentUserID > 0 {
		query = query.Where("is_private = ? OR (is_private = ? AND user_id = ?)", false, true, currentUserID)
	} else {
		query = query.Where("is_private = ?", false)
	}

	if len(labels) > 0 {
		var labelIds []uint
		for _, labelDto := range labels {
			label, _ := Label.GetLabelByValue(labelDto.Value)
			labelIds = append(labelIds, label.ID)
		}
		if labelRule == "intersection" {
			query = query.Joins("JOIN post_labels ON post_labels.post_id = posts.id").
				Where("post_labels.label_id IN ?", labelIds).
				Group("posts.id").
				Having("COUNT(DISTINCT post_labels.label_id) = ?", len(labelIds))
		} else {
			query = query.Joins("JOIN post_labels ON post_labels.post_id = posts.id").
				Where("post_labels.label_id IN ?", labelIds)
		}
	}

	if len(keywords) > 0 {
		for _, keyword := range keywords {
			if keyword != "" {
				query = query.Where("title LIKE ? OR content LIKE ?",
					"%"+keyword+"%", "%"+keyword+"%")
			}
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, 0, err
	}

	items, _, err := PaginateQuery[model.Post](query, page, size, orderBy, desc)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (p *postRepo) ToggleLikePost(postID uint, userID uint) (bool, error) {
	if postID == 0 || userID == 0 {
		return false, errs.New(http.StatusBadRequest, "invalid post ID or user ID", nil)
	}
	liked, err := Like.ToggleLike(userID, postID, constant.TargetTypePost)
	if err != nil {
		return false, err
	}
	return liked, nil
}
