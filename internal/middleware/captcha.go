package middleware

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
)

func UseCaptcha() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		// TODO: Implement captcha validation logic here
	}
}
