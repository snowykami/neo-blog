package service

import (
	"context"
	"strconv"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
)

type PostService struct{}

func NewPostService() *PostService {
	return &PostService{}
}

func (p *PostService) CreatePost(ctx context.Context, req *dto.CreateOrUpdatePostReq) (uint, error) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.ErrUnauthorized
	}
	post := &model.Post{
		Title:   req.Title,
		Content: req.Content,
		UserID:  currentUser.ID,
		Labels: func() []model.Label {
			labelModels := make([]model.Label, 0)
			for _, labelID := range req.Labels {
				labelModel, err := repo.Label.GetLabelByID(strconv.Itoa(int(labelID)))
				if err == nil {
					labelModels = append(labelModels, *labelModel)
				}
			}
			return labelModels
		}(),
		IsPrivate: req.IsPrivate,
	}
	if err := repo.Post.CreatePost(post); err != nil {
		return 0, err
	}
	return post.ID, nil
}

func (p *PostService) DeletePost(ctx context.Context, id string) error {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return errs.ErrUnauthorized
	}
	if id == "" {
		return errs.ErrBadRequest
	}
	post, err := repo.Post.GetPostByID(id)
	if err != nil {
		return errs.New(errs.ErrNotFound.Code, "post not found", err)
	}
	if post.UserID != currentUser.ID {
		return errs.ErrForbidden
	}
	if err := repo.Post.DeletePost(id); err != nil {
		return errs.ErrInternalServer
	}
	return nil
}

func (p *PostService) GetPost(ctx context.Context, id string) (*dto.PostDto, error) {
	if id == "" {
		return nil, errs.ErrBadRequest
	}
	post, err := repo.Post.GetPostByID(id)
	if err != nil {
		return nil, errs.New(errs.ErrNotFound.Code, "post not found", err)
	}
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if post.IsPrivate && (!ok || post.UserID != currentUser.ID) {
		return nil, errs.ErrForbidden
	}
	return post.ToDto(), nil
}

func (p *PostService) UpdatePost(ctx context.Context, id string, req *dto.CreateOrUpdatePostReq) (uint, error) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.ErrUnauthorized
	}
	if id == "" {
		return 0, errs.ErrBadRequest
	}
	post, err := repo.Post.GetPostByID(id)
	if err != nil {
		return 0, errs.New(errs.ErrNotFound.Code, "post not found", err)
	}
	if post.UserID != currentUser.ID {
		return 0, errs.ErrForbidden
	}
	post.Title = req.Title
	post.Content = req.Content
	post.IsPrivate = req.IsPrivate
	post.Labels = func() []model.Label {
		labelModels := make([]model.Label, len(req.Labels))
		for _, labelID := range req.Labels {
			labelModel, err := repo.Label.GetLabelByID(strconv.Itoa(int(labelID)))
			if err == nil {
				labelModels = append(labelModels, *labelModel)
			}
		}
		return labelModels
	}()
	if err := repo.Post.UpdatePost(post); err != nil {
		return 0, errs.ErrInternalServer
	}
	return post.ID, nil
}

func (p *PostService) ListPosts(ctx context.Context, req *dto.ListPostReq) ([]*dto.PostDto, error) {
	postDtos := make([]*dto.PostDto, 0)
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	posts, err := repo.Post.ListPosts(currentUserID, req.Keywords, req.Page, req.Size, req.OrderBy, req.Desc)
	if err != nil {
		return nil, errs.New(errs.ErrInternalServer.Code, "failed to list posts", err)
	}
	for _, post := range posts {
		postDtos = append(postDtos, post.ToDtoWithShortContent(100))
	}
	return postDtos, nil
}

func (p *PostService) ToggleLikePost(ctx context.Context, id string) (bool, error) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return false, errs.ErrUnauthorized
	}
	if id == "" {
		return false, errs.ErrBadRequest
	}
	post, err := repo.Post.GetPostByID(id)
	if err != nil {
		return false, errs.New(errs.ErrNotFound.Code, "post not found", err)
	}
	if post.UserID == currentUser.ID {
		return false, errs.ErrForbidden
	}
	idInt, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		return false, errs.New(errs.ErrBadRequest.Code, "invalid post ID", err)
	}
	liked, err := repo.Post.ToggleLikePost(uint(idInt), currentUser.ID)
	if err != nil {
		return false, errs.ErrInternalServer
	}
	return liked, nil
}
