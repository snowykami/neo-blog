package utils

import (
	"github.com/golang-jwt/jwt/v5"
	"github.com/snowykami/neo-blog/pkg/constant"
	"time"
)

type jwtUtils struct{}

var Jwt = jwtUtils{}

type Claims struct {
	jwt.RegisteredClaims
	UserID     uint   `json:"user_id"`
	SessionKey string `json:"session_key"` // 会话ID，仅在有状态Token中使用
	Stateful   bool   `json:"stateful"`    // 是否为有状态Token
}

// NewClaims 创建一个新的Claims实例，对于无状态
func (j *jwtUtils) NewClaims(userID uint, sessionKey string, stateful bool, duration time.Duration) *Claims {
	return &Claims{
		UserID:     userID,
		SessionKey: sessionKey,
		Stateful:   stateful,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
		},
	}
}

// ToString 将Claims转换为JWT字符串
func (c *Claims) ToString() (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return token.SignedString([]byte(Env.Get(constant.EnvKeyJwtSecrete, "default_jwt_secret")))
}

// ParseJsonWebTokenWithoutState 解析JWT令牌，仅检查无状态下是否valid，不对有状态的Token进行状态检查
func (j *jwtUtils) ParseJsonWebTokenWithoutState(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		return []byte(Env.Get(constant.EnvKeyJwtSecrete, "default_jwt_secret")), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}
	return claims, nil
}
