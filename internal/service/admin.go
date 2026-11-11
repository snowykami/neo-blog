package service

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

type AdminService struct{}

func NewAdminService() *AdminService {
	return &AdminService{}
}

func (c *AdminService) CreateOidcConfig(req *dto.CreateOidcConfigDto) *errs.ServiceError {
	oidcConfig := &model.OidcConfig{
		Name:                  req.Name,
		DisplayName:           req.DisplayName,
		Icon:                  req.Icon,
		ClientID:              req.ClientID,
		ClientSecret:          req.ClientSecret,
		TokenAuthMethod:       req.TokenAuthMethod,
		OidcDiscoveryUrl:      req.OidcDiscoveryUrl,
		Issuer:                req.Issuer,
		AuthorizationEndpoint: req.AuthorizationEndpoint,
		TokenEndpoint:         req.TokenEndpoint,
		UserinfoEndpoint:      req.UserinfoEndpoint,
		JwksUri:               req.JwksUri,
		Enabled:               req.Enabled,
		Type:                  req.Type,
	}
	if err := repo.Oidc.CreateOidcConfig(oidcConfig); err != nil {
		return errs.Internal("failed_to_create_target", err)
	}
	return nil
}

func (c *AdminService) DeleteOidcConfig(id uint) *errs.ServiceError {
	if err := repo.Oidc.DeleteOidcConfig(id); err != nil {
		return errs.Internal("failed_to_delete_target", err)
	}
	return nil
}

func (c *AdminService) GetOidcConfigByID(id uint) (*dto.AdminOidcConfigDto, *errs.ServiceError) {
	config, err := repo.Oidc.GetOidcConfigByID(id)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	return config.ToAdminDto(), nil
}

func (c *AdminService) ListOidcConfigs(onlyEnabled bool) ([]*dto.AdminOidcConfigDto, *errs.ServiceError) {
	configs, err := repo.Oidc.ListOidcConfigs(onlyEnabled)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	// 没有配置时返回空数组（JSON 为 []，不是 null）
	dtos := make([]*dto.AdminOidcConfigDto, 0, len(configs))
	for _, config := range configs {
		dtos = append(dtos, config.ToAdminDto())
	}
	return dtos, nil
}

func (c *AdminService) UpdateOidcConfig(req *dto.UpdateOidcConfigDto) *errs.ServiceError {
	oidcConfig := &model.OidcConfig{
		Model:                 gorm.Model{ID: req.ID},
		Name:                  req.Name,
		DisplayName:           req.DisplayName,
		Icon:                  req.Icon,
		ClientID:              req.ClientID,
		ClientSecret:          req.ClientSecret,
		TokenAuthMethod:       req.TokenAuthMethod,
		OidcDiscoveryUrl:      req.OidcDiscoveryUrl,
		Issuer:                req.Issuer,
		AuthorizationEndpoint: req.AuthorizationEndpoint,
		TokenEndpoint:         req.TokenEndpoint,
		UserinfoEndpoint:      req.UserinfoEndpoint,
		JwksUri:               req.JwksUri,
		Enabled:               req.Enabled,
		Type:                  req.Type,
	}
	if err := repo.Oidc.UpdateOidcConfig(oidcConfig); err != nil {
		return errs.Internal("failed_to_update_target", err)
	}
	return nil
}
