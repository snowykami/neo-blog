package ctxutils

import (
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// LoggedInCookie 登录标记：不含任何凭据、脚本可读（非 HttpOnly），有效期与刷新令牌一致。
// 前端页面对所有人渲染同一份外壳，浏览器据此判断要不要请求 /user/me，访客不必每次都收到一个 401
const LoggedInCookie = "logged_in"

// Set2Tokens 写入双令牌 Cookie：保留时长与令牌本身的到期时间一致（「记住我」的刷新令牌保留到它真正到期）
func Set2Tokens(c *app.RequestContext, token, refreshToken string) {
	durations := utils.Jwt.CurrentDurations()
	refreshMaxAge := utils.Jwt.CookieMaxAge(refreshToken, durations.Refresh)
	c.SetCookie("token", token, utils.Jwt.CookieMaxAge(token, durations.Access), "/", "", protocol.CookieSameSiteLaxMode, true, true)
	c.SetCookie("refresh_token", refreshToken, refreshMaxAge, "/", "", protocol.CookieSameSiteLaxMode, true, true)
	c.SetCookie(LoggedInCookie, "1", refreshMaxAge, "/", "", protocol.CookieSameSiteLaxMode, true, false)
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
	c.SetCookie(LoggedInCookie, "", -1, "/", "", protocol.CookieSameSiteLaxMode, true, false)
}
