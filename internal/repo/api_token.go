package repo

import (
	"time"

	"github.com/snowykami/neo-blog/internal/model"
)

type apiTokenRepo struct{}

var APIToken = &apiTokenRepo{}

func (a *apiTokenRepo) Create(token *model.APIToken) error {
	return GetDB().Create(token).Error
}

func (a *apiTokenRepo) GetByID(id uint) (*model.APIToken, error) {
	var token model.APIToken
	if err := GetDB().First(&token, id).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

func (a *apiTokenRepo) GetByHash(hash string) (*model.APIToken, error) {
	var token model.APIToken
	if err := GetDB().Where("token_hash = ?", hash).First(&token).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

// ListByUser 用户的全部 Token（含已吊销），新的在前
func (a *apiTokenRepo) ListByUser(userID uint) ([]model.APIToken, error) {
	var tokens []model.APIToken
	err := GetDB().Where("user_id = ?", userID).Order("id DESC").Find(&tokens).Error
	return tokens, err
}

// CountActiveByUser 未吊销且未过期的 Token 数量
func (a *apiTokenRepo) CountActiveByUser(userID uint, now time.Time) (int64, error) {
	var count int64
	err := GetDB().Model(&model.APIToken{}).
		Where("user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", userID, now).
		Count(&count).Error
	return count, err
}

func (a *apiTokenRepo) Revoke(id uint, now time.Time) error {
	return GetDB().Model(&model.APIToken{}).Where("id = ? AND revoked_at IS NULL", id).UpdateColumn("revoked_at", now).Error
}

// TouchLastUsed 更新最近使用时间，距上次记录不足 interval 时不写库
func (a *apiTokenRepo) TouchLastUsed(id uint, now time.Time, interval time.Duration) error {
	return GetDB().Model(&model.APIToken{}).
		Where("id = ? AND (last_used_at IS NULL OR last_used_at < ?)", id, now.Add(-interval)).
		UpdateColumn("last_used_at", now).Error
}
