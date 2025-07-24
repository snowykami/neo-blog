package repo

import (
	"fmt"
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

func (p *postRepo) ListPosts(currentUserID uint, keywords []string, page, size uint64, orderedBy string, reverse bool) ([]model.Post, error) {
	var posts []model.Post
	if !slices.Contains(constant.OrderedByEnumPost, orderedBy) {
		return nil, errs.New(http.StatusBadRequest, "invalid ordered_by parameter", nil)
	}
	order := orderedBy
	if reverse {
		order += " ASC"
	} else {
		order += " DESC"
	}
	query := GetDB().Model(&model.Post{}).Preload("User")
	if currentUserID > 0 {
		query = query.Where("is_private = ? OR (is_private = ? AND user_id = ?)", false, true, currentUserID)
	} else {
		query = query.Where("is_private = ?", false)
	}
	fmt.Println(keywords)
	if len(keywords) > 0 {
		for _, keyword := range keywords {
			if keyword != "" {
				// 使用LIKE进行模糊匹配，搜索标题、内容和标签
				query = query.Where("title LIKE ? OR content LIKE ?", // TODO: 支持标签搜索
					"%"+keyword+"%", "%"+keyword+"%")
			}
		}
	}
	query = query.Order(order).Offset(int((page - 1) * size)).Limit(int(size))
	if err := query.Find(&posts).Error; err != nil {
		return nil, err
	}
	return posts, nil
}
