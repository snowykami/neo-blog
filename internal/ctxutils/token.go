package ctxutils

import (
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/snowykami/neo-blog/pkg/utils"
)

func SetTokenCookie(c *app.RequestContext, token string) {
	maxAge := utils.Jwt.CookieMaxAge(token, utils.Jwt.CurrentDurations().Access)
	c.SetCookie("token", token, maxAge, "/", "", protocol.CookieSameSiteLaxMode, true, true)
}

// Set2Tokens 写入双令牌 Cookie：保留时长与令牌本身的到期时间一致（「记住我」的刷新令牌保留到它真正到期）
func Set2Tokens(c *app.RequestContext, token, refreshToken string) {
	durations := utils.Jwt.CurrentDurations()
	c.SetCookie("token", token, utils.Jwt.CookieMaxAge(token, durations.Access), "/", "", protocol.CookieSameSiteLaxMode, true, true)
	c.SetCookie("refresh_token", refreshToken, utils.Jwt.CookieMaxAge(refreshToken, durations.Refresh), "/", "", protocol.CookieSameSiteLaxMode, true, true)
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
