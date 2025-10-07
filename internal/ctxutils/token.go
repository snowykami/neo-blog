package ctxutils

import (
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/snowykami/neo-blog/pkg/utils"
)

func SetTokenCookie(c *app.RequestContext, token string) {
	c.SetCookie("token", token, int(utils.Jwt.TokenDuration.Seconds()), "/", "", protocol.CookieSameSiteLaxMode, true, true)
}

func Set2Tokens(c *app.RequestContext, token, refreshToken string) {
	c.SetCookie("token", token, int(utils.Jwt.TokenDuration.Seconds()), "/", "", protocol.CookieSameSiteLaxMode, true, true)
	c.SetCookie("refresh_token", refreshToken, int(utils.Jwt.RefreshTokenDuration.Seconds()), "/", "", protocol.CookieSameSiteLaxMode, true, true)
}

func Clear2Tokens(c *app.RequestContext) {
	c.SetCookie("token", "", -1, "/", "", protocol.CookieSameSiteLaxMode, true, true)
	c.SetCookie("refresh_token", "", -1, "/", "", protocol.CookieSameSiteLaxMode, true, true)
}
