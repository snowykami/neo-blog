package ctxutils

import (
	"context"
	"sync"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
)

const userCacheKey = "user_cache"

// userCache 当前请求的用户懒加载缓存，权限判断会多次读取当前用户，同一请求内只查一次库
type userCache struct {
	once sync.Once
	user *model.User
	ok   bool
}

// WithUserCache 在鉴权中间件写入 user_id 后调用，挂载当前请求的用户缓存
func WithUserCache(ctx context.Context) context.Context {
	return context.WithValue(ctx, userCacheKey, &userCache{})
}

func loadUser(userID uint) (*model.User, bool) {
	user, err := repo.User.GetUserByID(userID)
	// 被禁用的用户视同未登录，令牌未过期也立即失去所有权限
	if err != nil || user.Disabled {
		return nil, false
	}
	return user, true
}

// GetCurrentUser 从上下文中获取当前用户
func GetCurrentUser(ctx context.Context) (*model.User, bool) {
	userID, ok := ctx.Value("user_id").(uint)
	if !ok {
		return nil, false
	}
	if cache, ok := ctx.Value(userCacheKey).(*userCache); ok {
		cache.once.Do(func() { cache.user, cache.ok = loadUser(userID) })
		return cache.user, cache.ok
	}
	return loadUser(userID)
}

// GetCurrentUserID 从上下文中获取当前用户ID
func GetCurrentUserID(ctx context.Context) (uint, bool) {
	user, ok := GetCurrentUser(ctx)
	if !ok || user == nil {
		return 0, false
	}
	return user.ID, true
}
