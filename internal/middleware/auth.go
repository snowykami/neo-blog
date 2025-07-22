package middleware

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
	"time"
)

func UseAuth() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		// For cookie
		token := string(c.Cookie("token"))
		refreshToken := string(c.Cookie("refresh_token"))
		tokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(token)
		if err == nil && tokenClaims != nil {
			ctx = context.WithValue(ctx, "user_id", tokenClaims.UserID)
			c.Next(ctx)
			return
		}

		// token 失效 使用refresh token重新签发和鉴权
		refreshTokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(refreshToken)
		if err == nil && refreshTokenClaims != nil {
			ok, err := isStatefulJwtValid(refreshTokenClaims)
			if err == nil && ok {
				ctx = context.WithValue(ctx, "user_id", refreshTokenClaims.UserID) // 修改这里，使用refreshTokenClaims
				c.Next(ctx)
				newTokenClaims := utils.Jwt.NewClaims(refreshTokenClaims.UserID, refreshTokenClaims.SessionKey, refreshTokenClaims.Stateful, time.Duration(utils.Env.GetAsInt(constant.EnvKeyRefreshTokenDuration, 30)*int(time.Hour)))
				newToken, err := newTokenClaims.ToString()
				if err == nil {
					ctxutils.SetTokenCookie(c, newToken)
				} else {
					resps.InternalServerError(c, resps.ErrInternalServerError)
				}
				return
			}
		}

		// 所有认证方式都失败，返回未授权错误
		resps.UnAuthorized(c, resps.ErrUnauthorized)
		c.Abort()
	}
}

func isStatefulJwtValid(claims *utils.Claims) (bool, error) {
	if !claims.Stateful {
		return true, nil
	}
	return repo.Session.IsSessionValid(claims.SessionKey)
}
