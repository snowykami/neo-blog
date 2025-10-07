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

// IsAdmin checks if the current user is an admin，只匹配admin，不匹配 editor
func IsAdmin(ctx context.Context) bool {
	user, ok := GetCurrentUser(ctx)
	if !ok {
		return false
	}
	return user.IsAdmin()
}

func IsEditor(ctx context.Context) bool {
	user, ok := GetCurrentUser(ctx)
	if !ok {
		return false
	}
	return user.IsEditor()
}
