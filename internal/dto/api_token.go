package dto

import "time"

type APITokenDto struct {
	ID         uint       `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"` // 明文开头几位，用于辨认
	Scopes     []string   `json:"scopes"`
	ExpiresAt  *time.Time `json:"expires_at"` // 为空表示永不过期
	LastUsedAt *time.Time `json:"last_used_at"`
	RevokedAt  *time.Time `json:"revoked_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type CreateAPITokenReq struct {
	Name      string     `json:"name"`
	Scopes    []string   `json:"scopes"`
	ExpiresAt *time.Time `json:"expires_at"` // 为空表示永不过期
}

// CreateAPITokenResp 创建结果，Token 明文只在此返回一次
type CreateAPITokenResp struct {
	APIToken *APITokenDto `json:"api_token"`
	Token    string       `json:"token"`
}

type ListAPITokenResp struct {
	APITokens []*APITokenDto `json:"api_tokens"`
}
