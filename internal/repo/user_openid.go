package repo

import (
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/errs"
)

func (user *userRepo) CreateOrUpdateUserOpenID(userOpenID *model.UserOpenID) error {
	if err := GetDB().Save(userOpenID).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) GetUserOpenIDByID(id uint) (*model.UserOpenID, error) {
	if id == 0 {
		return nil, errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	var userOpenID model.UserOpenID
	if err := GetDB().Preload("User").Where("id = ?", id).First(&userOpenID).Error; err != nil {
		return nil, err
	}
	return &userOpenID, nil
}

func (user *userRepo) GetUserOpenIDByIssuerAndSub(issuer, sub string) (*model.UserOpenID, error) {
	if issuer == "" || sub == "" {
		return nil, errs.NewBadRequest("invalid_credentials")
	}
	var userOpenID model.UserOpenID
	if err := GetDB().Preload("User").Where("issuer = ? AND sub = ?", issuer, sub).First(&userOpenID).Error; err != nil {
		return nil, err
	}
	return &userOpenID, nil
}

func (user *userRepo) DeleteUserOpenID(id uint) error {
	if err := GetDB().Unscoped().Where("id = ?", id).Delete(&model.UserOpenID{}).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) UpdateUserOpenID(userOpenID *model.UserOpenID) error {
	if userOpenID.ID == 0 {
		return errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	if err := GetDB().Updates(userOpenID).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) ListUserOpenIDsByUserID(userID uint) ([]model.UserOpenID, error) {
	if userID == 0 {
		return []model.UserOpenID{}, nil
	}
	grouped, err := user.ListUserOpenIDsByUserIDs([]uint{userID})
	if err != nil {
		return nil, err
	}
	if list, ok := grouped[userID]; ok {
		return list, nil
	}
	return []model.UserOpenID{}, nil
}

// ListUserOpenIDsByUserIDs 批量读取用户绑定的外部账号并关联 OIDC 配置展示信息（避免列表 N+1 查询）
func (user *userRepo) ListUserOpenIDsByUserIDs(userIDs []uint) (map[uint][]model.UserOpenID, error) {
	result := make(map[uint][]model.UserOpenID)
	if len(userIDs) == 0 {
		return result, nil
	}
	var userOpenIDs []model.UserOpenID
	if err := GetDB().Where("user_id IN ?", userIDs).Order("id ASC").Find(&userOpenIDs).Error; err != nil {
		return nil, err
	}
	if len(userOpenIDs) == 0 {
		return result, nil
	}

	configs, err := Oidc.ListOidcConfigs(false)
	if err == nil && len(configs) > 0 {
		issuerMap := make(map[string]model.OidcConfig, len(configs))
		for _, cfg := range configs {
			if cfg.Issuer == "" {
				continue
			}
			if existing, ok := issuerMap[cfg.Issuer]; !ok || (!existing.Enabled && cfg.Enabled) {
				issuerMap[cfg.Issuer] = cfg
			}
		}
		for i := range userOpenIDs {
			if cfg, ok := issuerMap[userOpenIDs[i].Issuer]; ok {
				userOpenIDs[i].OidcName = cfg.Name
				userOpenIDs[i].OidcIcon = cfg.Icon
				userOpenIDs[i].OidcDisplayName = cfg.DisplayName
			}
		}
	}

	for _, item := range userOpenIDs {
		result[item.UserID] = append(result[item.UserID], item)
	}
	return result, nil
}
