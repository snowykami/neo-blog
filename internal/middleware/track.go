package middleware

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
)

func UseTrack() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		ctx = context.WithValue(ctx, "remote_addr", c.ClientIP())
		ctx = context.WithValue(ctx, "user_agent", c.UserAgent())
		c.Next(ctx)
	}
}
