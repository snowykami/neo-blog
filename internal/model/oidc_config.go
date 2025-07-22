package model

import (
	"fmt"
	"github.com/snowykami/neo-blog/internal/dto"
	"gorm.io/gorm"
	"resty.dev/v3"
	"time"
)

type OidcConfig struct {
	gorm.Model
	Name             string `gorm:"uniqueIndex"` // OIDC配置名称，唯一
	ClientID         string // 客户端ID
	ClientSecret     string // 客户端密钥
	DisplayName      string // 显示名称，例如：轻雪通行证
	Icon             string // 图标url，为空则使用内置默认图标
	OidcDiscoveryUrl string // OpenID自动发现URL，例如 ：https://pass.liteyuki.icu/.well-known/openid-configuration
	Enabled          bool   `gorm:"default:true"` // 是否启用
	// 以下字段为自动获取字段，每次更新配置时自动填充
	Issuer                string
	AuthorizationEndpoint string
	TokenEndpoint         string
	UserInfoEndpoint      string
	JwksUri               string
}

type oidcDiscoveryResp struct {
	Issuer                string `json:"issuer" validate:"required"`
	AuthorizationEndpoint string `json:"authorization_endpoint" validate:"required"`
	TokenEndpoint         string `json:"token_endpoint" validate:"required"`
	UserInfoEndpoint      string `json:"userinfo_endpoint" validate:"required"`
	JwksUri               string `json:"jwks_uri" validate:"required"`
	// 可选字段
	RegistrationEndpoint             string   `json:"registration_endpoint,omitempty"`
	ScopesSupported                  []string `json:"scopes_supported,omitempty"`
	ResponseTypesSupported           []string `json:"response_types_supported,omitempty"`
	GrantTypesSupported              []string `json:"grant_types_supported,omitempty"`
	SubjectTypesSupported            []string `json:"subject_types_supported,omitempty"`
	IdTokenSigningAlgValuesSupported []string `json:"id_token_signing_alg_values_supported,omitempty"`
	ClaimsSupported                  []string `json:"claims_supported,omitempty"`
	EndSessionEndpoint               string   `json:"end_session_endpoint,omitempty"`
}

func updateOidcConfigFromUrl(url string) (*oidcDiscoveryResp, error) {
	client := resty.New()
	client.SetTimeout(10 * time.Second) // 设置超时时间
	var discovery oidcDiscoveryResp
	resp, err := client.R().
		SetHeader("Accept", "application/json").
		SetResult(&discovery).
		Get(url)
	if err != nil {
		return nil, fmt.Errorf("请求OIDC发现端点失败: %w", err)
	}
	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("请求OIDC发现端点失败，状态码: %d", resp.StatusCode())
	}
	// 验证必要字段
	if discovery.Issuer == "" ||
		discovery.AuthorizationEndpoint == "" ||
		discovery.TokenEndpoint == "" ||
		discovery.UserInfoEndpoint == "" ||
		discovery.JwksUri == "" {
		return nil, fmt.Errorf("OIDC发现端点响应缺少必要字段")
	}
	return &discovery, nil
}

func (o *OidcConfig) BeforeSave(tx *gorm.DB) (err error) {
	// 只有在创建新记录或更新 OidcDiscoveryUrl 字段时才更新端点信息
	if tx.Statement.Changed("OidcDiscoveryUrl") {
		discoveryResp, err := updateOidcConfigFromUrl(o.OidcDiscoveryUrl)
		if err != nil {
			return fmt.Errorf("更新OIDC配置失败: %w", err)
		}
		o.Issuer = discoveryResp.Issuer
		o.AuthorizationEndpoint = discoveryResp.AuthorizationEndpoint
		o.TokenEndpoint = discoveryResp.TokenEndpoint
		o.UserInfoEndpoint = discoveryResp.UserInfoEndpoint
		o.JwksUri = discoveryResp.JwksUri
	}
	return nil
}

// ToDto 不包含LoginUrl，在service层自行实现
func (o *OidcConfig) ToDto() *dto.OidcConfigDto {
	return &dto.OidcConfigDto{
		Name:        o.Name,
		DisplayName: o.DisplayName,
		Icon:        o.Icon,
	}
}
