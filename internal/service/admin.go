package service

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"gorm.io/gorm"
)

type AdminService struct{}

func NewAdminService() *AdminService {
	return &AdminService{}
}

func (c *AdminService) GetDashboard() (map[string]any, error) {
	var (
		postCount, commentCount, userCount, viewCount int64
		err                                           error
		mustCount                                     = func(q *gorm.DB, dest *int64) {
			if err == nil {
				err = q.Count(dest).Error
			}
		}
		mustScan = func(q *gorm.DB, dest *int64) {
			if err == nil {
				err = q.Scan(dest).Error
			}
		}
	)
	db := repo.GetDB()

	mustCount(db.Model(&model.Comment{}), &commentCount)
	mustCount(db.Model(&model.Post{}), &postCount)
	mustCount(db.Model(&model.User{}), &userCount)
	mustScan(db.Model(&model.Post{}).Select("SUM(view_count)"), &viewCount)

	if err != nil {
		return nil, err
	}
	return map[string]any{
		"total_comments": commentCount,
		"total_posts":    postCount,
		"total_users":    userCount,
		"total_views":    viewCount,
	}, nil
}

func (c *AdminService) CreateOidcConfig(req *dto.CreateOidcConfigDto) error {
	oidcConfig := &model.OidcConfig{
		Name:                  req.Name,
		DisplayName:           req.DisplayName,
		Icon:                  req.Icon,
		ClientID:              req.ClientID,
		ClientSecret:          req.ClientSecret,
		OidcDiscoveryUrl:      req.OidcDiscoveryUrl,
		Issuer:                req.Issuer,
		AuthorizationEndpoint: req.AuthorizationEndpoint,
		TokenEndpoint:         req.TokenEndpoint,
		UserinfoEndpoint:      req.UserinfoEndpoint,
		JwksUri:               req.JwksUri,
		Enabled:               req.Enabled,
		Type:                  req.Type,
	}
	return repo.Oidc.CreateOidcConfig(oidcConfig)
}

func (c *AdminService) DeleteOidcConfig(id uint) error {
	return repo.Oidc.DeleteOidcConfig(id)
}

func (c *AdminService) GetOidcConfigByID(id uint) (*dto.AdminOidcConfigDto, error) {
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

func (c *AdminService) UpdateOidcConfig(req *dto.UpdateOidcConfigDto) error {
	oidcConfig := &model.OidcConfig{
		Model:                 gorm.Model{ID: req.ID},
		Name:                  req.Name,
		DisplayName:           req.DisplayName,
		Icon:                  req.Icon,
		ClientID:              req.ClientID,
		ClientSecret:          req.ClientSecret,
		OidcDiscoveryUrl:      req.OidcDiscoveryUrl,
		Issuer:                req.Issuer,
		AuthorizationEndpoint: req.AuthorizationEndpoint,
		TokenEndpoint:         req.TokenEndpoint,
		UserinfoEndpoint:      req.UserinfoEndpoint,
		JwksUri:               req.JwksUri,
		Enabled:               req.Enabled,
		Type:                  req.Type,
	}
	return repo.Oidc.UpdateOidcConfig(oidcConfig)
}
