package repo

import (
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/errs"
)

type oidcRepo struct {
}

var Oidc = &oidcRepo{}

func (o *oidcRepo) CreateOidcConfig(oidcConfig *model.OidcConfig) error {
	if err := GetDB().Create(oidcConfig).Error; err != nil {
		return err
	}
	return nil
}

func (o *oidcRepo) DeleteOidcConfig(id uint) error {
	if err := GetDB().Where("id = ?", id).Delete(&model.OidcConfig{}).Error; err != nil {
		return err
	}
	return nil
}

func (o *oidcRepo) ListOidcConfigs(onlyEnabled bool) ([]model.OidcConfig, error) {
	var configs []model.OidcConfig
	if onlyEnabled {
		if err := GetDB().Where("enabled = ?", true).Find(&configs).Error; err != nil {
			return nil, err
		}
	} else {
		if err := GetDB().Find(&configs).Error; err != nil {
			return nil, err
		}
	}
	return configs, nil
}

func (o *oidcRepo) GetOidcConfigByName(name string) (*model.OidcConfig, error) {
	var config model.OidcConfig
	if err := GetDB().Where("name = ?", name).First(&config).Error; err != nil {
		return nil, err
	}
	return &config, nil
}

func (o *oidcRepo) GetOidcConfigByID(id uint) (*model.OidcConfig, error) {
	var config model.OidcConfig
	if err := GetDB().Where("id = ?", id).First(&config).Error; err != nil {
		return nil, err
	}
	return &config, nil
}

func (o *oidcRepo) UpdateOidcConfig(oidcConfig *model.OidcConfig) error {
	if oidcConfig.ID == 0 {
		return errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	if err := GetDB().Select("Name", "ClientID", "ClientSecret",
		"DisplayName", "Icon", "OidcDiscoveryUrl",
		"Enabled", "Type").Updates(oidcConfig).Error; err != nil {
		return err
	}
	return nil
}
