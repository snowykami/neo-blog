package service

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

type PostService struct{}

func NewPostService() *PostService {
	return &PostService{}
}

func (p *PostService) CreatePost(ctx context.Context, req *dto.CreateOrUpdatePostReq) (uint, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.NewUnauthorized("login_required")
	}
	post := &model.Post{
		UserID: currentUser.ID,
		PostBase: model.PostBase{
			CategoryID:  req.CategoryID,
			Cover:       req.Cover,
			Content:     req.Content,
			Description: req.Description,
			IsPrivate:   req.IsPrivate,
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
			Top:   req.Top,
			Type:  req.Type,
		},
	}
	if err := repo.Post.CreatePost(post); err != nil {
		return 0, errs.NewInternalServer("failed_to_create_target")
	}
	return post.ID, nil
}

func (p *PostService) DeletePost(ctx context.Context, postId uint) *errs.ServiceError {
	if postId == 0 {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	post, err := repo.Post.GetPostBySlugOrID(strconv.FormatUint(uint64(postId), 10))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errs.NewNotFound("target_not_found")
		}
		return errs.NewInternalServer("failed_to_get_target")
	}
	if !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx)) {
		return errs.NewForbidden("permission_denied")
	}
	if err := repo.Post.DeletePost(postId); err != nil {
		return errs.NewInternalServer("failed_to_delete_target")
	}
	return nil
}

func (p *PostService) GetPostSlugOrId(ctx context.Context, slugOrId string) (*dto.PostDto, *errs.ServiceError) {
	if slugOrId == "" {
		return nil, errs.NewBadRequest("missing_request_parameters")
	}
	post, err := repo.Post.GetPostBySlugOrID(slugOrId)
	if err != nil {
		return nil, errs.NewNotFound("target_not_found")
	}
	currentUser, userOk := ctxutils.GetCurrentUser(ctx)
	// 私密文章只有自己和管理员能看
	if post.IsPrivate && !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx)) {
		return nil, errs.NewForbidden("permission_denied")
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

func (p *PostService) UpdatePost(ctx context.Context, req *dto.CreateOrUpdatePostReq) (uint, *errs.ServiceError) {
	post, err := repo.Post.GetPostBySlugOrID(strconv.FormatUint(uint64(req.ID), 10))
	if err != nil {
		return 0, errs.NewNotFound("target_not_found")
	}

	if !(ctxutils.IsAdmin(ctx) || ctxutils.IsOwnerOfTarget(ctx, post.UserID)) {
		return 0, errs.NewForbidden("permission_denied")
	}
	post.Top = req.Top // TOP可以为0
	utils.UpdateNonEmpty(&post.Title, req.Title)
	utils.UpdateNonEmpty(&post.Type, req.Type)
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
	if err := repo.Post.SavePost(post); err != nil {
		return 0, errs.NewInternalServer("failed_to_update_target")
	}
	return post.ID, nil
}

func (p *PostService) ListPosts(ctx context.Context, req *dto.ListPostReq) ([]*dto.PostDto, int64, *errs.ServiceError) {
	postDtos := make([]*dto.PostDto, 0)
	currentUserID, _ := ctxutils.GetCurrentUserID(ctx)
	keywordsArray := make([]string, 0)
	if req.Keywords != "" {
		for _, kw := range strings.Split(req.Keywords, ",") {
			keywordsArray = append(keywordsArray, strings.TrimSpace(kw))
		}
	}
	posts, total, err := repo.Post.ListPosts(currentUserID, keywordsArray, req)
	if err != nil {
		return nil, total, errs.NewInternalServer("failed_to_get_target")
	}
	for _, post := range posts {
		postDtos = append(postDtos, post.ToDtoWithShortContent(200))
	}
	return postDtos, total, nil
}
