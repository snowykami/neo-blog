package middleware

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// UseEmailVerify 中间件函数，用于邮箱验证，使用前先调用请求发送邮件验证码函数
func UseEmailVerify() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		email := string(c.GetHeader(constant.HeaderKeyEmail))
		verifyCode := string(c.GetHeader(constant.HeaderKeyVerifyCode))
		if !utils.Env.GetAsBool(constant.EnvKeyEnableEmailVerify, true) {
			c.Next(ctx)
		}
		if email == "" || verifyCode == "" {
			resps.BadRequest(c, "缺失email和verifyCode")
			return
		}
		ok := utils.VerifyEmailCode(email, verifyCode)
		if !ok {
			resps.Unauthorized(c, "验证码错误")
			return
		}
		c.Next(ctx)
	}
}
