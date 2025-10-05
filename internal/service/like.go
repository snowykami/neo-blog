package service

import (
	"context"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
)

type LikeService struct{}

func NewLikeService() *LikeService {
	return &LikeService{}
}

func (ls *LikeService) ToggleLike(ctx context.Context, targetID uint, targetType string) (bool, error) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return false, errs.ErrUnauthorized
	}
	return repo.Like.ToggleLike(currentUser.ID, targetID, targetType)
}

func (ls *LikeService) GetLikedUsers(ctx context.Context, targetID uint, targetType string, limit int) ([]dto.UserDto, error) {
	users, err := repo.Like.GetLikedUsers(targetID, targetType, limit)
	if err != nil {
		return nil, err
	}
	var userDtos []dto.UserDto
	for _, user := range users {
		userDtos = append(userDtos, user.ToDto())
	}
	return userDtos, nil
}
