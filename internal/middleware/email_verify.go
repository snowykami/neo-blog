package middleware

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// UseEmailVerify 中间件函数，用于邮箱验证，使用前先调用请求发送邮件验证码函数
func UseEmailVerify() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		req := &dto.EmailVerifyReq{}
		err := c.Bind(req)
		if err != nil {
			resps.BadRequest(c, "缺失email和verifyCode")
			return
		}
		// 如果全局关闭，则不允许
		if !utils.Env.GetAsBool(constant.EnvKeyEnableEmailVerify, true) {
			resps.Forbidden(c, "邮箱验证功能已关闭")
			c.Abort()
			return
		}
		if req.Email == "" || req.VerifyCode == "" {
			resps.BadRequest(c, "缺失email和verifyCode")
			return
		}
		ok := utils.VerifyEmailCode(req.Email, req.VerifyCode)
		if !ok {
			resps.Unauthorized(c, "验证码错误")
			return
		}
		c.Next(ctx)
	}
}
