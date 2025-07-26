package repo

import (
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"net/http"
	"slices"
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

func (p *postRepo) ListPosts(currentUserID uint, keywords []string, page, size uint64, orderBy string, desc bool) ([]model.Post, error) {
	if !slices.Contains(constant.OrderByEnumPost, orderBy) {
		return nil, errs.New(http.StatusBadRequest, "invalid order_by parameter", nil)
	}
	query := GetDB().Model(&model.Post{}).Preload("User")
	if currentUserID > 0 {
		query = query.Where("is_private = ? OR (is_private = ? AND user_id = ?)", false, true, currentUserID)
	} else {
		query = query.Where("is_private = ?", false)
	}
	if len(keywords) > 0 {
		for _, keyword := range keywords {
			if keyword != "" {
				// 使用LIKE进行模糊匹配，搜索标题、内容和标签
				query = query.Where("title LIKE ? OR content LIKE ?", // TODO: 支持标签搜索
					"%"+keyword+"%", "%"+keyword+"%")
			}
		}
	}
	items, _, err := PaginateQuery[model.Post](query, page, size, orderBy, desc)
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (p *postRepo) ToggleLikePost(postID uint, userID uint) error {
	if postID == 0 || userID == 0 {
		return errs.New(http.StatusBadRequest, "invalid post ID or user ID", nil)
	}
	err := Like.ToggleLike(userID, postID, constant.TargetTypePost)
	if err != nil {
		return err
	}
	return nil
}
