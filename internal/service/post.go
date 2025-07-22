package service

import (
	"context"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"net/http"
)

type PostService struct{}

func NewPostService() *PostService {
	return &PostService{}
}

func (p *PostService) CreatePost(ctx context.Context, req *dto.CreateOrUpdatePostReq) error {
	currentUser := ctxutils.GetCurrentUser(ctx)
	if currentUser == nil {
		return errs.ErrUnauthorized
	}

	post := &model.Post{
		Title:     req.Title,
		Content:   req.Content,
		UserID:    currentUser.ID,
		Labels:    req.Labels,
		IsPrivate: req.IsPrivate,
	}

	if err := repo.Post.CreatePost(post); err != nil {
		return err
	}
	return nil
}

func (p *PostService) DeletePost(ctx context.Context, id string) error {
}

func (p *PostService) GetPost(ctx context.Context, id string) (*model.Post, error) {}

func (p *PostService) UpdatePost(req *dto.CreateOrUpdatePostReq) error {}

func (p *PostService) ListPosts() {}
