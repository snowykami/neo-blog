package repo

import (
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

type oauthRepo struct{}

var OAuth = &oauthRepo{}

func (o *oauthRepo) CreateClient(client *model.OAuthClient) error {
	return GetDB().Create(client).Error
}

func (o *oauthRepo) GetClientByClientID(clientID string) (*model.OAuthClient, error) {
	var client model.OAuthClient
	if err := GetDB().Where("client_id = ?", clientID).First(&client).Error; err != nil {
		return nil, err
	}
	return &client, nil
}

func (o *oauthRepo) CreateToken(token *model.OAuthToken) error {
	return GetDB().Create(token).Error
}

func (o *oauthRepo) GetTokenByAccessHash(hash string) (*model.OAuthToken, error) {
	var token model.OAuthToken
	if err := GetDB().Where("access_token_hash = ?", hash).First(&token).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

func (o *oauthRepo) GetTokenByRefreshHash(hash string) (*model.OAuthToken, error) {
	var token model.OAuthToken
	if err := GetDB().Where("refresh_token_hash = ?", hash).First(&token).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

// RotateRefreshToken 原子轮换刷新令牌：
//  1. 仅当旧记录未被消费、未吊销且未过期时，原子标记 refresh_consumed_at 并立即作废其附带的旧 access_token，随后写入同一 family_id 的新令牌行；
//  2. 若检测到旧 refresh_token 已被消费过（重放攻击），在同一已提交事务内吊销整个 family_id 令牌族并返回 replayed = true。
func (o *oauthRepo) RotateRefreshToken(oldToken *model.OAuthToken, newToken *model.OAuthToken, now time.Time) (bool, error) {
	var replayed bool
	err := GetDB().Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&model.OAuthToken{}).
			Where("id = ? AND refresh_consumed_at IS NULL AND revoked_at IS NULL AND refresh_expires_at > ?", oldToken.ID, now).
			UpdateColumns(map[string]any{
				"refresh_consumed_at": now,
				"access_expires_at":   now,
				"updated_at":          now,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			var latest model.OAuthToken
			if err := tx.First(&latest, oldToken.ID).Error; err != nil {
				return err
			}
			replayed = true
			if latest.RefreshConsumedAt != nil && latest.FamilyID != "" {
				return tx.Model(&model.OAuthToken{}).
					Where("family_id = ? AND revoked_at IS NULL", latest.FamilyID).
					UpdateColumns(map[string]any{
						"revoked_at": now,
						"updated_at": now,
					}).Error
			}
			return nil
		}
		return tx.Create(newToken).Error
	})
	return replayed, err
}

// RevokeFamily 吊销指定令牌族下的全部未吊销令牌（如检测到授权码或刷新令牌重放时）
func (o *oauthRepo) RevokeFamily(familyID string, now time.Time) error {
	if familyID == "" {
		return nil
	}
	return GetDB().Model(&model.OAuthToken{}).
		Where("family_id = ? AND revoked_at IS NULL", familyID).
		UpdateColumns(map[string]any{
			"revoked_at": now,
			"updated_at": now,
		}).Error
}

// RevokeByClientAndHash 按客户端归属与明文哈希吊销令牌（RFC 7009）：
//   - 若命中 refresh_token_hash，吊销其所属的整个 family_id 令牌族；
//   - 若命中 access_token_hash，仅吊销该条记录；
//   - 不属于该 client_id 或不存在时静默无操作。
func (o *oauthRepo) RevokeByClientAndHash(clientID, tokenHash string, now time.Time) error {
	return GetDB().Transaction(func(tx *gorm.DB) error {
		var byRefresh model.OAuthToken
		if err := tx.Where("client_id = ? AND refresh_token_hash = ?", clientID, tokenHash).First(&byRefresh).Error; err == nil {
			if byRefresh.FamilyID != "" {
				return tx.Model(&model.OAuthToken{}).
					Where("client_id = ? AND family_id = ? AND revoked_at IS NULL", clientID, byRefresh.FamilyID).
					UpdateColumns(map[string]any{
						"revoked_at": now,
						"updated_at": now,
					}).Error
			}
			return tx.Model(&model.OAuthToken{}).
				Where("id = ? AND revoked_at IS NULL", byRefresh.ID).
				UpdateColumns(map[string]any{
					"revoked_at": now,
					"updated_at": now,
				}).Error
		} else if err != gorm.ErrRecordNotFound {
			return err
		}

		return tx.Model(&model.OAuthToken{}).
			Where("client_id = ? AND access_token_hash = ? AND revoked_at IS NULL", clientID, tokenHash).
			UpdateColumns(map[string]any{
				"revoked_at": now,
				"updated_at": now,
			}).Error
	})
}

// TouchLastUsed 节流更新最近使用时间
func (o *oauthRepo) TouchLastUsed(id uint, now time.Time, interval time.Duration) error {
	return GetDB().Model(&model.OAuthToken{}).
		Where("id = ? AND (last_used_at IS NULL OR last_used_at < ?)", id, now.Add(-interval)).
		UpdateColumn("last_used_at", now).Error
}

// RevokeAllByUser 吊销指定用户的全部 OAuth 令牌（账号禁用、重置密码、转为 AI 用户时调用）
func (o *oauthRepo) RevokeAllByUser(userID uint, now time.Time) error {
	return GetDB().Model(&model.OAuthToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		UpdateColumns(map[string]any{
			"revoked_at": now,
			"updated_at": now,
		}).Error
}

// CleanupExpired 清理早已过期的令牌记录与长期未产生有效授权的孤儿动态注册客户端
func (o *oauthRepo) CleanupExpired(tokenExpiredBefore, orphanClientBefore time.Time) (int64, int64, error) {
	tokenRes := GetDB().
		Where("access_expires_at < ? AND (refresh_expires_at IS NULL OR refresh_expires_at < ? OR revoked_at IS NOT NULL)", tokenExpiredBefore, tokenExpiredBefore).
		Delete(&model.OAuthToken{})
	if tokenRes.Error != nil {
		return 0, 0, tokenRes.Error
	}

	activeClients := GetDB().Model(&model.OAuthToken{}).Select("client_id")
	clientRes := GetDB().
		Where("created_at < ? AND client_id NOT IN (?)", orphanClientBefore, activeClients).
		Delete(&model.OAuthClient{})
	if clientRes.Error != nil {
		return tokenRes.RowsAffected, 0, clientRes.Error
	}
	return tokenRes.RowsAffected, clientRes.RowsAffected, nil
}
