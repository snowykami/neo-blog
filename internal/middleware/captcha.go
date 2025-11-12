package middleware

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// UseCaptcha 中间件函数，用于X-Captcha-Token验证码
func UseCaptcha() app.HandlerFunc {
	captchaConfig := utils.Captcha.GetCaptchaConfigFromEnv()
	return func(ctx context.Context, c *app.RequestContext) {
		CaptchaToken := string(c.GetHeader("X-Captcha-Token"))
		if utils.IsDevMode && CaptchaToken == utils.Env.Get(constant.EnvKeyPasscode, constant.DefaultCaptchaDevPasscode) {
			// 开发模式直接通过密钥，开启开发模式后，Captcha可被绕过，请注意安全
			c.Next(ctx)
			return
		}
		ok, err := utils.Captcha.VerifyCaptcha(captchaConfig, CaptchaToken)
		if err != nil {
			logrus.Error("Captcha verification error:", err)
			resps.InternalServerError(c, "Captcha verification failed")
			c.Abort()
			return
		}
		if !ok {
			logrus.Warn("Captcha verification failed for token:", CaptchaToken)
			resps.Forbidden(c, "Captcha verification failed")
			c.Abort()
			return
		}
		c.Next(ctx) // 如果验证码验证成功，则继续下一个处理程序
	}
}
