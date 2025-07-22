package ctxutils

import (
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

func SetTokenCookie(c *app.RequestContext, token string) {
	c.SetCookie("token", token, utils.Env.GetAsInt(constant.EnvKeyTokenDuration, constant.EnvKeyTokenDurationDefault), "/", "", protocol.CookieSameSiteLaxMode, true, true)
}

func SetTokenAndRefreshTokenCookie(c *app.RequestContext, token, refreshToken string) {
	c.SetCookie("token", token, utils.Env.GetAsInt(constant.EnvKeyTokenDuration, constant.EnvKeyTokenDurationDefault), "/", "", protocol.CookieSameSiteLaxMode, true, true)
	c.SetCookie("refresh_token", refreshToken, -1, "/", "", protocol.CookieSameSiteLaxMode, true, true)
}

func ClearTokenAndRefreshTokenCookie(c *app.RequestContext) {
	c.SetCookie("token", "", -1, "/", "", protocol.CookieSameSiteLaxMode, true, true)
	c.SetCookie("refresh_token", "", -1, "/", "", protocol.CookieSameSiteLaxMode, true, true)
}
