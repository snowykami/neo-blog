package ctxutils

import (
	"context"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
)

func GetCurrentUser(ctx context.Context) *model.User {
	userIDValue := ctx.Value("user_id").(uint)
	if userIDValue <= 0 {
		return nil
	}
	user, err := repo.User.GetUserByID(userIDValue)
	if err != nil || user == nil || user.ID == 0 {
		return nil
	}
	return user
}
