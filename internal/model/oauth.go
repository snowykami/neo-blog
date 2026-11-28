package model

import "time"

const (
	OAuthAuthMethodNone              = "none"
	OAuthAuthMethodClientSecretBasic = "client_secret_basic"
	OAuthAuthMethodClientSecretPost  = "client_secret_post"
)

// OAuthClient 动态注册的 OAuth 2.1 客户端（RFC 7591），用于远程 MCP 客户端授权连接
type OAuthClient struct {
	ID                      uint      `gorm:"primarykey"`
	CreatedAt               time.Time `gorm:"index:idx_oauth_clients_created"`
	UpdatedAt               time.Time
	ClientID                string   `gorm:"type:varchar(128);not null;uniqueIndex:idx_oauth_clients_client_id"`
	ClientSecretHash        *string  `gorm:"type:varchar(64)"`
	ClientName              string   `gorm:"type:varchar(128);not null"`
	ClientURI               string   `gorm:"type:varchar(512);not null;default:''"`
	LogoURI                 string   `gorm:"type:varchar(512);not null;default:''"`
	RedirectURIs            []string `gorm:"type:text;serializer:json;not null"`
	GrantTypes              []string `gorm:"type:text;serializer:json;not null"`
	TokenEndpointAuthMethod string   `gorm:"type:varchar(32);not null"`
	Scope                   string   `gorm:"type:varchar(512);not null;default:''"`
}

func (OAuthClient) TableName() string {
	return "oauth_clients"
}

func (c *OAuthClient) IsPublic() bool {
	return c.TokenEndpointAuthMethod == OAuthAuthMethodNone
}

// OAuthToken 已签发的 OAuth 2.1 访问令牌与刷新令牌（只存 SHA-256 哈希，明文只在签发时返回一次）
type OAuthToken struct {
	ID                uint `gorm:"primarykey"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
	UserID            uint       `gorm:"not null;index:idx_oauth_tokens_user_id"`
	User              *User      `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE;"`
	ClientID          string     `gorm:"type:varchar(128);not null;index:idx_oauth_tokens_client_id"`
	FamilyID          string     `gorm:"type:varchar(64);not null;index:idx_oauth_tokens_family_id"`
	Scopes            []string   `gorm:"type:text;serializer:json;not null"`
	AccessTokenHash   string     `gorm:"type:varchar(64);not null;uniqueIndex:idx_oauth_tokens_access_hash"`
	AccessExpiresAt   time.Time  `gorm:"not null;index:idx_oauth_tokens_access_expires"`
	RefreshTokenHash  *string    `gorm:"type:varchar(64);uniqueIndex:idx_oauth_tokens_refresh_hash"`
	RefreshExpiresAt  *time.Time `gorm:"index:idx_oauth_tokens_refresh_expires"`
	RefreshConsumedAt *time.Time
	LastUsedAt        *time.Time
	RevokedAt         *time.Time `gorm:"index:idx_oauth_tokens_revoked_at"`
}

func (OAuthToken) TableName() string {
	return "oauth_tokens"
}
