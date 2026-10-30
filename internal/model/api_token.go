package model

import (
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"gorm.io/gorm"
)

// APIToken 个人 API Token：明文只在创建时返回一次，库中只保存哈希
type APIToken struct {
	gorm.Model
	UserID     uint   `gorm:"index;not null"`
	User       User   `gorm:"foreignKey:UserID;references:ID"`
	Name       string `gorm:"type:varchar(64);not null"`
	TokenHash  string `gorm:"type:varchar(64);uniqueIndex;not null"` // 明文的 SHA-256
	Prefix     string `gorm:"type:varchar(16)"`                      // 明文开头几位，用于在列表中辨认
	Scopes     string `gorm:"type:text"`                             // 权限范围，逗号分隔
	ExpiresAt  *time.Time
	LastUsedAt *time.Time
	RevokedAt  *time.Time
}

func (t *APIToken) ScopeList() []string {
	if t.Scopes == "" {
		return []string{}
	}
	return strings.Split(t.Scopes, ",")
}

func (t *APIToken) IsRevoked() bool {
	return t.RevokedAt != nil
}

func (t *APIToken) IsExpired(now time.Time) bool {
	return t.ExpiresAt != nil && !now.Before(*t.ExpiresAt)
}

func (t *APIToken) ToDto() *dto.APITokenDto {
	return &dto.APITokenDto{
		ID:         t.ID,
		Name:       t.Name,
		Prefix:     t.Prefix,
		Scopes:     t.ScopeList(),
		ExpiresAt:  t.ExpiresAt,
		LastUsedAt: t.LastUsedAt,
		RevokedAt:  t.RevokedAt,
		CreatedAt:  t.CreatedAt,
	}
}
