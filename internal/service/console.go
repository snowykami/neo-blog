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

func (c *AdminService) CreateOidcConfig(req *dto.AdminOidcConfigDto) error {
	oidcConfig := &model.OidcConfig{
		Name:             req.Name,
		DisplayName:      req.DisplayName,
		Icon:             req.Icon,
		ClientID:         req.ClientID,
		ClientSecret:     req.ClientSecret,
		OidcDiscoveryUrl: req.OidcDiscoveryUrl,
		Enabled:          req.Enabled,
	}
	return repo.Oidc.CreateOidcConfig(oidcConfig)
}

func (c *AdminService) DeleteOidcConfig(id string) error {
	if id == "" {
		return errs.ErrBadRequest
	}
	return repo.Oidc.DeleteOidcConfig(id)
}

func (c *AdminService) GetOidcConfigByID(id string) (*dto.AdminOidcConfigDto, error) {
	if id == "" {
		return nil, errs.ErrBadRequest
	}
	config, err := repo.Oidc.GetOidcConfigByID(id)
	if err != nil {
		return nil, err
	}
	return config.ToAdminDto(), nil
}

func (c *AdminService) ListOidcConfigs(onlyEnabled bool) ([]*dto.AdminOidcConfigDto, error) {
	configs, err := repo.Oidc.ListOidcConfigs(onlyEnabled)
	if err != nil {
		return nil, err
	}
	var dtos []*dto.AdminOidcConfigDto
	for _, config := range configs {
		dtos = append(dtos, config.ToAdminDto())
	}
	return dtos, nil
}

func (c *AdminService) UpdateOidcConfig(req *dto.AdminOidcConfigDto) error {
	if req.ID == 0 {
		return errs.ErrBadRequest
	}
	oidcConfig := &model.OidcConfig{
		Model:            gorm.Model{ID: req.ID},
		Name:             req.Name,
		DisplayName:      req.DisplayName,
		Icon:             req.Icon,
		ClientID:         req.ClientID,
		ClientSecret:     req.ClientSecret,
		OidcDiscoveryUrl: req.OidcDiscoveryUrl,
		Enabled:          req.Enabled,
	}
	return repo.Oidc.UpdateOidcConfig(oidcConfig)
}
