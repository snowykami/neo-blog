package repo

import (
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/errs"
	"net/http"
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

func (p *postRepo) ListPosts(limit, offset int) ([]model.Post, error) {
	var posts []model.Post
	if err := GetDB().Limit(limit).Offset(offset).Find(&posts).Error; err != nil {
		return nil, err
	}
	return posts, nil
}
