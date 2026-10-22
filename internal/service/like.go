package service

import (
	"context"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
)

type LikeService struct{}

func NewLikeService() *LikeService {
	return &LikeService{}
}

func (ls *LikeService) ToggleLike(ctx context.Context, targetID uint, targetType string) (bool, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return false, errs.NewUnauthorized("login_required")
	}
	// 只能给存在且自己看得到的目标点赞，避免产生孤儿点赞
	switch targetType {
	case constant.TargetTypePost:
		post, err := repo.Post.GetPostMeta(targetID)
		if err != nil || (post.IsPrivate && !(ctxutils.IsOwnerOfTarget(ctx, post.UserID) || ctxutils.IsAdmin(ctx))) {
			return false, errs.NewNotFound("operation_target_not_found")
		}
	case constant.TargetTypeComment:
		if _, svcerr := NewCommentService().GetComment(ctx, targetID); svcerr != nil {
			return false, svcerr
		}
	default:
		return false, errs.NewBadRequest("invalid_target_type")
	}
	state, err := repo.Like.ToggleLike(currentUser.ID, targetID, targetType)
	if err != nil {
		return state, errs.NewInternalServer("failed_to_toggle_like")
	}
	return state, nil
}

func (ls *LikeService) GetLikedUsers(ctx context.Context, targetID uint, targetType string, limit int) ([]dto.UserDto, *errs.ServiceError) {
	users, err := repo.Like.GetLikedUsers(targetID, targetType, limit)
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	var userDtos []dto.UserDto
	for _, user := range users {
		userDtos = append(userDtos, user.ToDto())
	}
	return userDtos, nil
}
