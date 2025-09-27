package ctxutils

import (
	"context"
)

func IsOwnerOfTarget(ctx context.Context, targetUserID uint) bool {
	userID, ok := GetCurrentUserID(ctx)
	if !ok {
		return false
	}
	return userID == targetUserID
}

func IsAdmin(ctx context.Context) bool {
	user, ok := GetCurrentUser(ctx)
	if !ok {
		return false
	}
	return user.IsAdmin()
}
