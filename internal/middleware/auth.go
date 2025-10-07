package middleware

import (
	"context"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
	"golang.org/x/sync/singleflight"
)

var ipCacheDuration = 30 * time.Minute
var ipSingleflight singleflight.Group

func UseAuth(block bool) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		token := string(c.Cookie("token"))
		if token == "" {
			token = strings.TrimPrefix(string(c.GetHeader("Authorization")), "Bearer ")
		}

		// 解析 无状态token
		if token != "" {
			tokenClaims, err := utils.Jwt.ParseJsonWebTokenWithoutState(token)
			if err == nil && tokenClaims != nil {
				ctx = context.WithValue(ctx, "user_id", tokenClaims.UserID)
				ctx = context.WithValue(ctx, "session_id", tokenClaims.SessionID)
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
			if err == nil || refreshTokenClaims != nil {
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
					ctx = context.WithValue(ctx, "user_id", refreshTokenClaims.UserID)
					ctx = context.WithValue(ctx, "session_id", refreshTokenClaims.SessionID)
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

// UseRole 检查用户角色是否符合要求，必须在 UseAuth 之后使用
// requiredRole 可以是 "admin", "editor", "user" 等
// admin包含editor， editor包含user
func UseRole(requiredRole string) app.HandlerFunc {
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

func isStatefulJwtValid(claims *utils.Claims) (bool, error) {
	return repo.Session.IsSessionValid(claims.SessionID)
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
