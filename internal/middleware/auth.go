package middleware

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
	"strings"
	"time"
)

func UseAuth(block bool) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		// For cookie
		tokenFromCookie := string(c.Cookie("token"))
		tokenFromHeader := strings.TrimPrefix(string(c.GetHeader("Authorization")), "Bearer ")
		refreshToken := string(c.Cookie("refresh_token"))

		// 尝试用普通 tokenFromCookie 认证
		if tokenFromCookie != "" {
			tokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(tokenFromCookie)
			if err == nil && tokenClaims != nil {
				ctx = context.WithValue(ctx, constant.ContextKeyUserID, tokenClaims.UserID)
				c.Next(ctx)
				logrus.Debugf("UseAuth: tokenFromCookie authenticated successfully, userID: %d", tokenClaims.UserID)
				return
			}
			logrus.Debugf("UseAuth: tokenFromCookie authentication failed, error: %v", err)
		}
		// tokenFromCookie 认证失败，尝试用 Bearer tokenFromHeader 认证
		if tokenFromHeader != "" {
			tokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(tokenFromHeader)
			if err == nil && tokenClaims != nil {
				ctx = context.WithValue(ctx, constant.ContextKeyUserID, tokenClaims.UserID)
				c.Next(ctx)
				logrus.Debugf("UseAuth: tokenFromHeader authenticated successfully, userID: %d", tokenClaims.UserID)
				return
			}
			logrus.Debugf("UseAuth: tokenFromHeader authentication failed, error: %v", err)
		}
		// tokenFromCookie 失效 使用 refresh tokenFromCookie 重新签发和鉴权
		refreshTokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(refreshToken)
		if err == nil && refreshTokenClaims != nil {
			ok, err := isStatefulJwtValid(refreshTokenClaims)
			if err == nil && ok {
				ctx = context.WithValue(ctx, constant.ContextKeyUserID, refreshTokenClaims.UserID)
				// 生成新 tokenFromCookie
				newTokenClaims := utils.Jwt.NewClaims(
					refreshTokenClaims.UserID,
					refreshTokenClaims.SessionKey,
					refreshTokenClaims.Stateful,
					time.Duration(utils.Env.GetAsInt(constant.EnvKeyRefreshTokenDuration, 30)*int(time.Hour)),
				)
				newToken, err := newTokenClaims.ToString()
				if err == nil {
					ctxutils.SetTokenCookie(c, newToken)
				} else {
					resps.InternalServerError(c, resps.ErrInternalServerError)
				}
				c.Next(ctx)
				logrus.Debugf("UseAuth: refreshToken authenticated successfully, userID: %d", refreshTokenClaims.UserID)
				return
			}
		}

		// 所有认证方式都失败
		if block {
			logrus.Debug("UseAuth: all authentication methods failed, blocking request")
			resps.Unauthorized(c, resps.ErrUnauthorized)
			c.Abort()
		} else {
			logrus.Debug("UseAuth: all authentication methods failed, blocking request")
			c.Next(ctx)
		}
	}
}

func isStatefulJwtValid(claims *utils.Claims) (bool, error) {
	if !claims.Stateful {
		return true, nil
	}
	return repo.Session.IsSessionValid(claims.SessionKey)
}
