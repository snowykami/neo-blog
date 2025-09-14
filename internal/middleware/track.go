package middleware

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func UseTrack() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		ctx = context.WithValue(ctx, constant.ContextKeyRemoteAddr, c.ClientIP())
		ctx = context.WithValue(ctx, constant.ContextKeyUserAgent, c.UserAgent())
		c.Next(ctx)
	}
}
