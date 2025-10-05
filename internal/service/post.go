package service

import (
	"context"
	"strconv"
	"strings"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
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
		UserID: currentUser.ID,
		PostBase: model.PostBase{
			CategoryID: req.CategoryID,
			Cover:      req.Cover,
			Content:    req.Content,
			IsPrivate:  req.IsPrivate,
			Labels: func() []model.Label {
				labelModels := make([]model.Label, 0)
				for _, labelID := range req.LabelIds {
					labelModel, err := repo.Label.GetLabelByID(labelID)
					if err == nil {
						labelModels = append(labelModels, *labelModel)
					}
				}
				return labelModels
			}(),
			Slug:  req.Slug,
			Title: req.Title,
		},
	}
	if err := repo.Post.CreatePost(post); err != nil {
		return 0, err
	}
	return post.ID, nil
}

func (p *PostService) DeletePost(ctx context.Context, id uint) error {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return errs.ErrUnauthorized
	}
	if id == 0 {
		return errs.ErrBadRequest
	}
	post, err := repo.Post.GetPostBySlugOrID(strconv.FormatUint(uint64(id), 10))
	if err != nil {
		return errs.New(errs.ErrNotFound.Code, "post not found", err)
	}
	if (post.UserID != currentUser.ID) && (currentUser.Role != constant.RoleAdmin) {
		return errs.ErrForbidden
	}
	if err := repo.Post.DeletePost(id); err != nil {
		return errs.ErrInternalServer
	}
	return nil
}

func (p *PostService) GetPostSlugOrId(ctx context.Context, slugOrId string) (*dto.PostDto, error) {
	if slugOrId == "" {
		return nil, errs.ErrBadRequest
	}
	post, err := repo.Post.GetPostBySlugOrID(slugOrId)
	if err != nil {
		return nil, errs.New(errs.ErrNotFound.Code, "post not found", err)
	}
	currentUser, userOk := ctxutils.GetCurrentUser(ctx)
	if post.IsPrivate && (!userOk || post.UserID != currentUser.ID) {
		return nil, errs.ErrForbidden
	}
	// 检测用户是否点赞
	postDto := post.ToDto()
	if userOk {
		liked, err := repo.Like.IsLiked(currentUser.ID, post.ID, constant.TargetTypePost)
		if err == nil {
			postDto.IsLiked = liked
		}
	}
	return postDto, nil
}

func (p *PostService) UpdatePost(ctx context.Context, id uint, req *dto.CreateOrUpdatePostReq) (uint, error) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.ErrUnauthorized
	}
	if id == 0 {
		return 0, errs.ErrBadRequest
	}
	post, err := repo.Post.GetPostBySlugOrID(strconv.FormatUint(uint64(id), 10))
	if err != nil {
		return 0, errs.New(errs.ErrNotFound.Code, "post not found", err)
	}
	if post.UserID != currentUser.ID {
		return 0, errs.ErrForbidden
	}
	utils.UpdateNonEmpty(&post.Title, req.Title)
	utils.UpdateNonEmpty(&post.Content, req.Content)
	utils.UpdateNonEmpty(&post.Cover, req.Cover)
	utils.UpdateNonEmpty(&post.Description, req.Description)
	utils.UpdatePtrNonZero(&post.DraftContent, req.DraftContent)
	utils.UpdatePtrNonZero(&post.Slug, req.Slug)
	utils.UpdatePtrUint(&post.CategoryID, req.CategoryID)
	utils.UpdateBool(&post.IsPrivate, req.IsPrivate)
	post.Labels = func() []model.Label {
		labelModels := make([]model.Label, len(req.LabelIds))
		for i, labelID := range req.LabelIds {
			labelModel, err := repo.Label.GetLabelByID(labelID)
			if err == nil {
				labelModels[i] = *labelModel
			} else {
				labelModels = append(labelModels[:i], labelModels[i+1:]...)
			}
		}
		return labelModels
	}()
	if err := repo.Post.UpdatePost(post); err != nil {
		return 0, errs.ErrInternalServer
	}
	return post.ID, nil
}

func (p *PostService) ListPosts(ctx context.Context, req *dto.ListPostReq) ([]*dto.PostDto, int64, error) {
	postDtos := make([]*dto.PostDto, 0)
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	keywordsArray := make([]string, 0)
	if req.Keywords != "" {
		for _, kw := range strings.Split(req.Keywords, ",") {
			keywordsArray = append(keywordsArray, strings.TrimSpace(kw))
		}
	}
	posts, total, err := repo.Post.ListPosts(currentUserID, keywordsArray, req.Label, req.Page, req.Size, req.OrderBy, req.Desc, req.UserID)
	if err != nil {
		return nil, total, errs.New(errs.ErrInternalServer.Code, "failed to list posts", err)
	}
	for _, post := range posts {
		postDtos = append(postDtos, post.ToDtoWithShortContent(200))
	}
	return postDtos, total, nil
}

func (p *PostService) ToggleLikePost(ctx context.Context, id string) (bool, error) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return false, errs.ErrUnauthorized
	}
	if id == "" {
		return false, errs.ErrBadRequest
	}
	post, err := repo.Post.GetPostBySlugOrID(id)
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
