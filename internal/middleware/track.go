package middleware

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/service"
)

// UseTrack 记录请求来源，并统计进行中的请求、请求数、耗时与 5xx（用于后台的运行时指标）
func UseTrack() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		done := service.TrackRequest(string(c.Path()))
		// 处理函数 panic 时也要结束计数，否则进行中的请求数会一直偏高
		defer func() { done(c.Response.StatusCode()) }()
		ctx = context.WithValue(ctx, "remote_addr", c.ClientIP())
		ctx = context.WithValue(ctx, "user_agent", c.UserAgent())
		c.Next(ctx)
	}
}
