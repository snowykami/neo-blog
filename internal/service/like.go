package service

import (
	"context"

	"github.com/snowykami/neo-blog/internal/ctxutils"
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
