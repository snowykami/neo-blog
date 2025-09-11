package repo

import (
	"errors"
	"net/http"
	"slices"

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

func (p *postRepo) GetPostByID(id string) (*model.Post, error) {
	var post model.Post
	if err := GetDB().Where("id = ?", id).Preload("User").First(&post).Error; err != nil {
		return nil, err
	}
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
			label, _ := Label.GetLabelByKeyAndValue(labelDto.Key, labelDto.Value)
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
