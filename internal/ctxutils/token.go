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

const OidcNonceCookie = "oidc_nonce"

// EnsureOidcNonce 读取或生成浏览器 OIDC nonce，OIDC 回调时用于校验 state 属于当前浏览器
func EnsureOidcNonce(c *app.RequestContext) string {
	nonce := string(c.Cookie(OidcNonceCookie))
	if len(nonce) != 32 {
		nonce = utils.Strings.GenerateRandomString(32)
	}
	c.SetCookie(OidcNonceCookie, nonce, 10*60, "/", "", protocol.CookieSameSiteLaxMode, true, true)
	return nonce
}

func Clear2Tokens(c *app.RequestContext) {
	c.SetCookie("token", "", -1, "/", "", protocol.CookieSameSiteLaxMode, true, true)
	c.SetCookie("refresh_token", "", -1, "/", "", protocol.CookieSameSiteLaxMode, true, true)
}
