package ctxutils

import (
	"context"
	"slices"
)

const apiTokenKey = "api_token"

// APITokenInfo 本次请求使用的个人 API Token 或 OAuth Access Token；Scopes 已与用户角色取交集。
// ID 仅在个人 API Token（api_tokens 表）认证时非 0，OAuth 令牌使用 OAuthTokenID，避免污染 content_revisions.api_token_id 外键
type APITokenInfo struct {
	ID           uint
	OAuthTokenID uint
	Name         string
	Scopes       []string
}

// WithAPIToken 鉴权中间件通过 API Token 认证后挂载 Token 信息
func WithAPIToken(ctx context.Context, info *APITokenInfo) context.Context {
	return context.WithValue(ctx, apiTokenKey, info)
}

// GetAPIToken 当前请求使用的 API Token，浏览器会话登录时返回 false
func GetAPIToken(ctx context.Context) (*APITokenInfo, bool) {
	info, ok := ctx.Value(apiTokenKey).(*APITokenInfo)
	return info, ok && info != nil
}

// GetAPITokenID 当前请求使用的 API Token ID，没有时返回 0
func GetAPITokenID(ctx context.Context) uint {
	if info, ok := GetAPIToken(ctx); ok {
		return info.ID
	}
	return 0
}

// HasAPITokenScope 当前请求通过 API Token 认证且具有指定权限范围
func HasAPITokenScope(ctx context.Context, scope string) bool {
	info, ok := GetAPIToken(ctx)
	return ok && slices.Contains(info.Scopes, scope)
}
