package middleware

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// UseEmailVerify 中间件函数，用于邮箱验证，使用前先调用请求发送邮件验证码函数
func UseEmailVerify() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		req := &dto.EmailVerifyReq{}
		err := c.Bind(req)
		if err != nil {
			resps.BadRequest(c, "missing_email_or_verify_code")
			return
		}
		// 如果全局关闭，则不允许
		if !config.Bool("enable_email_verify") {
			resps.Forbidden(c, "email_verify_disabled")
			c.Abort()
			return
		}
		if req.Email == "" || req.VerifyCode == "" {
			resps.BadRequest(c, "missing_email_or_verify_code")
			return
		}
		ok := utils.VerifyEmailCode(req.Email, req.VerifyCode)
		if !ok {
			resps.Unauthorized(c, "invalid_verify_code")
			return
		}
		c.Next(ctx)
	}
}
