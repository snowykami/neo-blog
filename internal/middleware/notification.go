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
			if token := string(c.GetHeader(NotifyPrefsTokenHeader)); token != "" {
				if userID, err := service.ParseNotificationPrefsToken(token, time.Now()); err == nil {
					ctx = context.WithValue(ctx, "user_id", userID)
					ctx = ctxutils.WithUserCache(ctx)
				}
			}
		}
		c.Next(ctx)
	}
}
