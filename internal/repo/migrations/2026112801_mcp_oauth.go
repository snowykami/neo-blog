package migrations

import (
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

type oauthClient2026112801 struct {
	ID                      uint      `gorm:"primarykey"`
	CreatedAt               time.Time `gorm:"index:idx_oauth_clients_created"`
	UpdatedAt               time.Time
	ClientID                string  `gorm:"type:varchar(128);not null;uniqueIndex:idx_oauth_clients_client_id"`
	ClientSecretHash        *string `gorm:"type:varchar(64)"`
	ClientName              string  `gorm:"type:varchar(128);not null"`
	ClientURI               string  `gorm:"type:varchar(512);not null;default:''"`
	LogoURI                 string  `gorm:"type:varchar(512);not null;default:''"`
	RedirectURIs            string  `gorm:"type:text;not null"`
	GrantTypes              string  `gorm:"type:text;not null"`
	TokenEndpointAuthMethod string  `gorm:"type:varchar(32);not null"`
	Scope                   string  `gorm:"type:varchar(512);not null;default:''"`
}

func (oauthClient2026112801) TableName() string {
	return "oauth_clients"
}

type oauthToken2026112801 struct {
	ID                uint `gorm:"primarykey"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
	UserID            uint       `gorm:"not null;index:idx_oauth_tokens_user_id"`
	ClientID          string     `gorm:"type:varchar(128);not null;index:idx_oauth_tokens_client_id"`
	FamilyID          string     `gorm:"type:varchar(64);not null;index:idx_oauth_tokens_family_id"`
	Scopes            string     `gorm:"type:text;not null"`
	AccessTokenHash   string     `gorm:"type:varchar(64);not null;uniqueIndex:idx_oauth_tokens_access_hash"`
	AccessExpiresAt   time.Time  `gorm:"not null;index:idx_oauth_tokens_access_expires"`
	RefreshTokenHash  *string    `gorm:"type:varchar(64);uniqueIndex:idx_oauth_tokens_refresh_hash"`
	RefreshExpiresAt  *time.Time `gorm:"index:idx_oauth_tokens_refresh_expires"`
	RefreshConsumedAt *time.Time
	LastUsedAt        *time.Time
	RevokedAt         *time.Time `gorm:"index:idx_oauth_tokens_revoked_at"`
}

func (oauthToken2026112801) TableName() string {
	return "oauth_tokens"
}

// mcpOAuth 新增 MCP OAuth 2.1 动态注册客户端表与令牌表
func mcpOAuth() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026112801_mcp_oauth",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&oauthClient2026112801{}) {
				if err := tx.Migrator().CreateTable(&oauthClient2026112801{}); err != nil {
					return err
				}
			}
			if !tx.Migrator().HasTable(&oauthToken2026112801{}) {
				if err := tx.Migrator().CreateTable(&oauthToken2026112801{}); err != nil {
					return err
				}
			}
			return nil
		},
	}
}
