package middleware

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
	"golang.org/x/sync/singleflight"
)

var ipCacheDuration = 30 * time.Minute
var ipSingleflight singleflight.Group

// UseAuth 认证中间件，验证用户身份, block参数决定认证失败时是否阻断请求, 否则起一个用户记录作用
// tokenScopes 为空时不接受个人 API Token（默认拒绝）；非空时额外接受同时具有这些权限范围的 API Token
func UseAuth(block bool, tokenScopes ...string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		if raw := bearerAPIToken(c); raw != "" && len(tokenScopes) > 0 {
			apiCtx, svcerr := authenticateAPIToken(ctx, raw, tokenScopes)
			if svcerr == nil {
				c.Next(apiCtx)
				return
			}
			if block {
				abortAPITokenError(c, svcerr)
				return
			}
			c.Next(ctx)
			return
		}

		token := string(c.Cookie("token"))
		if token == "" {
			token = strings.TrimPrefix(string(c.GetHeader("Authorization")), "Bearer ")
		}

		// 解析 无状态token
		if token != "" {
			tokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(token)
			if err == nil && tokenClaims != nil && tokenClaims.TokenType == utils.JwtTokenTypeAccess {
				ctx = context.WithValue(ctx, "user_id", tokenClaims.UserID)
				ctx = context.WithValue(ctx, "session_id", tokenClaims.SessionID)
				ctx = ctxutils.WithUserCache(ctx)
				err := recordUserIP(tokenClaims.SessionID, c.ClientIP())
				if err != nil {
					logrus.Warnf("recordUserIP error: %v", err)
				}
				logrus.Debugf("user_id: %d, session_id: %s pass", tokenClaims.UserID, tokenClaims.SessionID)
				c.Next(ctx)
				return
			}
		}

		// token解析失败，尝试解析 有状态 refresh token
		refreshToken := string(c.Cookie("refresh_token"))
		if refreshToken != "" {
			refreshTokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(refreshToken)
			if err == nil && refreshTokenClaims != nil && refreshTokenClaims.TokenType == utils.JwtTokenTypeRefresh {
				valid, err := isStatefulJwtValid(refreshTokenClaims)
				if err == nil && valid {
					// 刷新双token
					newToken, newRefreshToken, err := utils.Jwt.New2Tokens(refreshTokenClaims.UserID, refreshTokenClaims.SessionID, false)
					if err != nil {
						resps.InternalServerError(c, "Failed to generate new tokens")
						c.Abort()
						return
					}
					// 判断refreshToken有效期是否充足，若是则赋值为旧的refreshToken，这是为了应对rememberMe策略的长session
					if time.Until(refreshTokenClaims.ExpiresAt.Time) > 30*time.Minute {
						newRefreshToken = refreshToken
					}

					ctxutils.Set2Tokens(c, newToken, newRefreshToken)
					touchSessionThrottled(refreshTokenClaims.SessionID)
					ctx = context.WithValue(ctx, "user_id", refreshTokenClaims.UserID)
					ctx = context.WithValue(ctx, "session_id", refreshTokenClaims.SessionID)
					ctx = ctxutils.WithUserCache(ctx)
					err = recordUserIP(refreshTokenClaims.SessionID, c.ClientIP())
					if err != nil {
						logrus.Warnf("recordUserIP error: %v", err)
					}
					logrus.Debugf("user_id: %d, session_id: %s refresh pass", refreshTokenClaims.UserID, refreshTokenClaims.SessionID)
					c.Next(ctx)
					return
				}
			}
		}

		// 认证失败
		if block {
			logrus.Debug("UseAuth: failed and blocking request")
			resps.Unauthorized(c, resps.ErrUnauthorized)
			c.Abort()
			return
		}
		// 不阻断请求，继续传递
		logrus.Debug("UseAuth: failed but not blocking request")
		c.Next(ctx)
	}
}

// UseAPIToken 只接受个人 API Token 的鉴权，用于 MCP 等面向外部工具的接口
// 不接受浏览器 Cookie，避免登录态被跨站请求借用；具体操作所需的权限范围由调用方检查
func UseAPIToken() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		raw := bearerAPIToken(c)
		if raw == "" {
			abortAPITokenError(c, errs.NewUnauthorized("invalid_api_token"))
			return
		}
		apiCtx, svcerr := authenticateAPIToken(ctx, raw, nil)
		if svcerr != nil {
			abortAPITokenError(c, svcerr)
			return
		}
		c.Next(apiCtx)
	}
}

// bearerAPIToken 取出 Authorization 头中的个人 API Token，不是 API Token 时返回空
func bearerAPIToken(c *app.RequestContext) string {
	raw := strings.TrimSpace(strings.TrimPrefix(string(c.GetHeader("Authorization")), "Bearer "))
	if !strings.HasPrefix(raw, constant.APITokenPrefix) {
		return ""
	}
	return raw
}

// authenticateAPIToken 校验 API Token 并要求具有全部 requiredScopes，通过后在上下文中写入用户与 Token 信息
func authenticateAPIToken(ctx context.Context, raw string, requiredScopes []string) (context.Context, *errs.ServiceError) {
	userID, info, svcerr := service.NewAPITokenService().Authenticate(raw)
	if svcerr != nil {
		return ctx, svcerr
	}
	if len(info.Scopes) == 0 {
		return ctx, errs.NewForbidden("api_token_scope_insufficient")
	}
	for _, scope := range requiredScopes {
		if !slices.Contains(info.Scopes, scope) {
			return ctx, errs.NewForbidden("api_token_scope_insufficient")
		}
	}
	ctx = context.WithValue(ctx, "user_id", userID)
	ctx = ctxutils.WithUserCache(ctx)
	ctx = ctxutils.WithAPIToken(ctx, info)
	logrus.Debugf("user_id: %d, api_token_id: %d pass", userID, info.ID)
	return ctx, nil
}

func abortAPITokenError(c *app.RequestContext, svcerr *errs.ServiceError) {
	if svcerr.Code == http.StatusUnauthorized {
		c.Header("WWW-Authenticate", `Bearer realm="neo-blog", error="invalid_token"`)
	}
	resps.Error(c, svcerr)
}

// UseRole 检查用户角色是否符合要求，必须在 UseAuth 之后使用
// requiredRole 可以是 "admin", "editor", "user" 等
// admin包含editor， editor包含user
func UseRole(requiredRole constant.Role) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		currentUser, ok := ctxutils.GetCurrentUser(ctx)
		if !ok || currentUser == nil {
			resps.Unauthorized(c, resps.ErrUnauthorized)
			c.Abort()
			return
		}
		switch requiredRole {
		case constant.RoleAdmin:
			if !currentUser.IsAdmin() {
				resps.Forbidden(c, resps.ErrForbidden)
				c.Abort()
				return
			}
		case constant.RoleEditor:
			if !(currentUser.IsAdmin() || currentUser.IsEditor()) {
				resps.Forbidden(c, resps.ErrForbidden)
				c.Abort()
				return
			}
		case constant.RoleUser:
			// 所有登录用户均为user，无需额外检查
		default:
			resps.InternalServerError(c, "Invalid role configuration")
			c.Abort()
			return
		}
		c.Next(ctx)
	}
}

// touchSessionThrottled 刷新会话活跃时间，同一会话 10 分钟内只写一次库
func touchSessionThrottled(sessionID string) {
	kv := utils.KV.GetInstance()
	key := "session_touch_" + sessionID
	if kv.Lookup(key) {
		return
	}
	if err := repo.Session.TouchSession(sessionID); err != nil {
		logrus.Warnf("touch session error: %v", err)
		return
	}
	kv.Set(key, true, 10*time.Minute)
}

func isStatefulJwtValid(claims *utils.Claims) (bool, error) {
	if claims == nil {
		return false, nil
	}
	return repo.Session.IsSessionValidForUser(claims.SessionID, claims.UserID)
}

// 这块缓存到kv中，当kv中没有时再查库，然后更新到数据库，ip缓存时间为30分钟，防止内存中存储过多ip
func recordUserIP(sessionId, ip string) error {
	// 参数校验
	if sessionId == "" || ip == "" {
		return nil
	}
	// 保留地址排除，有可能是前端服务端在请求
	if utils.IsReservedIP(ip) {
		return nil
	}

	kv := utils.KV.GetInstance()
	key := "session_ip_" + sessionId

	// 先尝试从 KV 读取，若一致则直接返回
	if v, ok := kv.Get(key); ok {
		if cur, _ := v.(string); cur == ip {
			return nil
		}
	}

	// singleflight 避免并发短时间内多次写 DB
	_, err, _ := ipSingleflight.Do(key, func() (interface{}, error) {
		// 再次校验 KV，减少窗口期写入
		if v2, ok2 := kv.Get(key); ok2 {
			if cur2, _ := v2.(string); cur2 == ip {
				return nil, nil
			}
		}

		// 从 DB 读取最后一次 IP（防止 KV 丢失导致重复写）
		lastIP, dbErr := repo.Session.GetSessionLastIP(sessionId)
		if dbErr != nil {
			return nil, dbErr
		}
		if lastIP == ip {
			// 更新 KV 并结束
			kv.Set(key, ip, ipCacheDuration)
			return nil, nil
		}

		// 写入 DB（附带时间戳），写成功后再更新 KV
		if dbErr = repo.Session.AddSessionIPRecord(sessionId, ip); dbErr != nil {
			return nil, dbErr
		}
		kv.Set(key, ip, ipCacheDuration)
		return nil, nil
	})

	return err
}
