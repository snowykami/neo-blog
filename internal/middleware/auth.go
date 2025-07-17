package middleware

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
)

func UseAuth() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		// TODO: Implement authentication logic here
	}
}
