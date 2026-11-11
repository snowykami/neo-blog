package middleware

import (
	"context"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/service"
)

// NotifyPrefsTokenHeader 邮件里「通知设置」链接携带的免登录凭据
const NotifyPrefsTokenHeader = "X-Notify-Prefs-Token"

// UseNotifyPrefsToken 只挂在通知偏好接口上：已登录时以登录身份为准，
// 没有登录时用请求头里的凭据，写一个受限身份（只能操作通知偏好，改不了昵称、密码、邮箱）
func UseNotifyPrefsToken() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		if _, ok := ctx.Value("user_id").(uint); !ok {
			ctx = withNotifyPrefsToken(ctx, string(c.GetHeader(NotifyPrefsTokenHeader)))
		}
		c.Next(ctx)
	}
}

// UseNotifyPrefsQueryToken 只挂在邮件头的一键退订接口上（RFC 8058）：邮箱客户端直接 POST，
// 不带 Cookie 与自定义请求头，凭据在查询参数 token 里；不认登录身份
func UseNotifyPrefsQueryToken() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		c.Next(withNotifyPrefsToken(ctx, c.Query("token")))
	}
}

// withNotifyPrefsToken 凭据有效时写入受限身份
func withNotifyPrefsToken(ctx context.Context, token string) context.Context {
	if token == "" {
		return ctx
	}
	userID, err := service.ParseNotificationPrefsToken(token, time.Now())
	if err != nil {
		return ctx
	}
	ctx = context.WithValue(ctx, "user_id", userID)
	return ctxutils.WithUserCache(ctx)
}
