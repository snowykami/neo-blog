package utils

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/snowykami/neo-blog/pkg/constant"
)

var defaultJwtKey = Strings.GenerateRandomString(32)

const (
	JwtTokenTypeAccess  = "access"
	JwtTokenTypeRefresh = "refresh"
)

// JwtDurations 访问令牌与刷新令牌的有效期（刷新令牌分普通与「记住我」）
type JwtDurations struct {
	Access          time.Duration
	Refresh         time.Duration
	RefreshRemember time.Duration
}

// DefaultJwtDurations 默认有效期；实际值由后台配置或环境变量决定（见 internal/tools.GetAuthDurations）
var DefaultJwtDurations = JwtDurations{
	Access:          300 * time.Second,
	Refresh:         7 * 24 * time.Hour,
	RefreshRemember: 30 * 24 * time.Hour,
}

// SigningSecret 令牌签名密钥（JWT_SECRET，未设置时为本进程的随机值），其他自签令牌由它派生密钥
func (j *jwtUtils) SigningSecret() string {
	return Env.Get(constant.EnvKeyJwtSecrete, defaultJwtKey)
}

type jwtUtils struct {
	// Durations 返回当前有效期，启动时注入（读取后台配置，pkg 不依赖 internal）；未注入时用默认值
	Durations func() JwtDurations
}

var Jwt = jwtUtils{}

// CurrentDurations 当前生效的有效期
func (j *jwtUtils) CurrentDurations() JwtDurations {
	if j.Durations != nil {
		return j.Durations()
	}
	return DefaultJwtDurations
}

func (j *jwtUtils) durations() JwtDurations {
	return j.CurrentDurations()
}

// CookieMaxAge 令牌 Cookie 的保留时长（秒）：取令牌本身剩余的有效期，Cookie 与令牌同时到期；
// 解析失败时取 fallback（如「记住我」的刷新令牌按 30 天，而不是固定按普通有效期，否则浏览器会提前删掉 Cookie）
func (j *jwtUtils) CookieMaxAge(token string, fallback time.Duration) int {
	if claims, err := j.ParseJsonWebTokenWithoutState(token); err == nil && claims.ExpiresAt != nil {
		return max(0, int(time.Until(claims.ExpiresAt.Time).Seconds()))
	}
	return int(fallback.Seconds())
}

type Claims struct {
	jwt.RegisteredClaims
	UserID    uint   `json:"user_id"`
	SessionID string `json:"session_id"`         // 会话ID，仅在有状态Token中使用
	TokenType string `json:"token_type"`         // token用途：access 或 refresh
	Remember  bool   `json:"remember,omitempty"` // 刷新令牌：登录时勾选了「记住我」，续期时沿用
}

// RememberMe 刷新令牌是否属于「记住我」的会话：新令牌带有标记；旧令牌没有标记，按签发时的有效期是否超过普通有效期判断
func (c *Claims) RememberMe() bool {
	if c.Remember {
		return true
	}
	if c.ExpiresAt == nil || c.IssuedAt == nil {
		return false
	}
	return c.ExpiresAt.Sub(c.IssuedAt.Time) > Jwt.durations().Refresh
}

// ToString 将Claims转换为JWT字符串
func (c *Claims) ToString() (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return token.SignedString([]byte(Env.Get(constant.EnvKeyJwtSecrete, defaultJwtKey)))
}

// NewClaims 创建一个新的Claims实例
func (j *jwtUtils) NewClaims(userID uint, sessionID string, duration time.Duration, tokenType string) *Claims {
	return &Claims{
		UserID:    userID,
		SessionID: sessionID,
		TokenType: tokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
		},
	}
}

func (j *jwtUtils) NewTokenClaims(userID uint, sessionID string) *Claims {
	return j.NewClaims(userID, sessionID, j.durations().Access, JwtTokenTypeAccess)
}

func (j *jwtUtils) NewRefreshClaims(userID uint, sessionID string, rememberMe bool) *Claims {
	durations := j.durations()
	if rememberMe {
		claims := j.NewClaims(userID, sessionID, durations.RefreshRemember, JwtTokenTypeRefresh)
		claims.Remember = true
		return claims
	}
	return j.NewClaims(userID, sessionID, durations.Refresh, JwtTokenTypeRefresh)
}

// New2Tokens 同时生成访问Token和刷新Token，自行处理持久化
func (j *jwtUtils) New2Tokens(userID uint, sessionID string, rememberMe bool) (tokenString, refreshTokenString string, err error) {
	tokenClaims := j.NewTokenClaims(userID, sessionID)
	tokenString, err = tokenClaims.ToString()
	if err != nil {
		return "", "", err
	}
	refreshClaims := j.NewRefreshClaims(userID, sessionID, rememberMe)
	refreshTokenString, err = refreshClaims.ToString()
	if err != nil {
		return "", "", err
	}
	return tokenString, refreshTokenString, nil
}

// ParseJsonWebTokenWithoutState 解析JWT令牌，仅检查无状态下是否valid，不对有状态的Token进行状态检查
func (j *jwtUtils) ParseJsonWebTokenWithoutState(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		return []byte(Env.Get(constant.EnvKeyJwtSecrete, defaultJwtKey)), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}
	return claims, nil
}
