package ctxutils

import (
	"context"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
)

// GetCurrentUser 从上下文中获取当前用户
func GetCurrentUser(ctx context.Context) (*model.User, bool) {
	val := ctx.Value("user_id")
	if val == nil {
		return nil, false
	}
	user, err := repo.User.GetUserByID(val.(uint))
	if err != nil {
		return nil, false
	}
	return user, true
}

// GetCurrentUserID 从上下文中获取当前用户ID
func GetCurrentUserID(ctx context.Context) (uint, bool) {
	user, ok := GetCurrentUser(ctx)
	if !ok || user == nil {
		return 0, false
	}
	return user.ID, true
}
