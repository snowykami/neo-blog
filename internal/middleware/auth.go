package middleware

import (
	"context"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
)

func UseAuth(block bool) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		// For cookie
		req := &dto.AuthReq{}
		err := c.Bind(req)
		if err != nil {
			logrus.Errorf("UseAuth: failed to bind request: %v", err)
		}
		req.TokenFromHeader = strings.TrimPrefix(req.TokenFromHeader, "Bearer ")
		// 尝试用普通 tokenFromCookie 认证
		if req.TokenFromCookie != "" {
			tokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(req.TokenFromCookie)
			if err == nil && tokenClaims != nil {
				ctx = context.WithValue(ctx, constant.ContextKeyUserID, tokenClaims.UserID)
				ctx = context.WithValue(ctx, constant.ContextKeySessionKey, tokenClaims.SessionKey)
				c.Next(ctx)
				logrus.Debugf("User: %d , SessionKey: %s pass", tokenClaims.UserID, tokenClaims.SessionKey)
				return
			}
			logrus.Debugf("Auth failed, error: %v", err)
		}
		// tokenFromCookie 认证失败，尝试用 Bearer tokenFromHeader 认证
		if req.TokenFromHeader != "" {
			tokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(req.TokenFromHeader)
			if err == nil && tokenClaims != nil {
				ctx = context.WithValue(ctx, constant.ContextKeyUserID, tokenClaims.UserID)
				ctx = context.WithValue(ctx, constant.ContextKeySessionKey, tokenClaims.SessionKey)
				c.Next(ctx)
				logrus.Debugf("UseAuth: tokenFromHeader authenticated successfully, userID: %d", tokenClaims.UserID)
				return
			}
			logrus.Debugf("UseAuth: tokenFromHeader authentication failed, error: %v", err)
		}
		// tokenFromCookie 失效 使用 refresh tokenFromCookie 重新签发和鉴权
		refreshTokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(req.RefreshTokenFromCookie)
		if err == nil && refreshTokenClaims != nil {
			// 检查refresh token有效期
			ok, err := isStatefulJwtValid(refreshTokenClaims)
			if err == nil && ok {
				ctx = context.WithValue(ctx, constant.ContextKeyUserID, refreshTokenClaims.UserID)
				ctx = context.WithValue(ctx, constant.ContextKeySessionKey, refreshTokenClaims.SessionKey)
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
			logrus.Debug("UseAuth: all authentication methods failed, pass request")
			c.Next(ctx)
		}
	}
}

// UseRole 检查用户角色是否符合要求，必须在 UseAuth 之后使用
// requiredRole 可以是 "admin", "editor", "user" 等
// admin包含editor， editor包含user
func UseRole(requiredRole string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		currentUserID := ctx.Value(constant.ContextKeyUserID)
		if currentUserID == nil {
			resps.Unauthorized(c, resps.ErrUnauthorized)
			c.Abort()
			return
		}
		userID := currentUserID.(uint)
		user, err := repo.User.GetUserByID(userID)
		if err != nil {
			resps.InternalServerError(c, resps.ErrInternalServerError)
			c.Abort()
			return
		}
		if user == nil {
			resps.Unauthorized(c, resps.ErrUnauthorized)
			c.Abort()
			return
		}

		roleHierarchy := map[string]int{
			constant.RoleUser:   1,
			constant.RoleEditor: 2,
			constant.RoleAdmin:  3,
		}
		userRoleLevel := roleHierarchy[user.Role]
		requiredRoleLevel := roleHierarchy[requiredRole]
		if userRoleLevel < requiredRoleLevel {
			resps.Forbidden(c, resps.ErrForbidden)
			c.Abort()
			return
		}
		c.Next(ctx)
	}
}

func isStatefulJwtValid(claims *utils.Claims) (bool, error) {
	if !claims.Stateful {
		return true, nil
	}
	return repo.Session.IsSessionValid(claims.SessionKey)
}
