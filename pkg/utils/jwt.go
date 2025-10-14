package utils

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/snowykami/neo-blog/pkg/constant"
)

var defaultJwtKey = Strings.GenerateRandomString(32)

type jwtUtils struct {
	TokenDuration                      time.Duration
	RefreshTokenDuration               time.Duration
	RefreshTokenDurationWithRememberMe time.Duration
}

var Jwt = jwtUtils{
	TokenDuration:                      time.Second * 60,    // 默认Token有效期
	RefreshTokenDuration:               time.Hour * 24 * 3,  // 默认Refresh Token有效期
	RefreshTokenDurationWithRememberMe: time.Hour * 24 * 15, // 记住我情况下的Refresh Token有效期
}

type Claims struct {
	jwt.RegisteredClaims
	UserID    uint   `json:"user_id"`
	SessionID string `json:"session_id"` // 会话ID，仅在有状态Token中使用
}

// ToString 将Claims转换为JWT字符串
func (c *Claims) ToString() (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return token.SignedString([]byte(Env.Get(constant.EnvKeyJwtSecrete, defaultJwtKey)))
}

// NewClaims 创建一个新的Claims实例
func (j *jwtUtils) NewClaims(userID uint, sessionID string, duration time.Duration) *Claims {
	return &Claims{
		UserID:    userID,
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
		},
	}
}

func (j *jwtUtils) NewTokenClaims(userID uint, sessionID string) *Claims {
	return j.NewClaims(userID, sessionID, j.TokenDuration)
}

func (j *jwtUtils) NewRefreshClaims(userID uint, sessionID string, rememberMe bool) *Claims {
	if rememberMe {
		return j.NewClaims(userID, sessionID, j.RefreshTokenDurationWithRememberMe)
	}
	return j.NewClaims(userID, sessionID, j.RefreshTokenDuration)
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
