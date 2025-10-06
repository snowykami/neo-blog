package dto

type AdminOidcConfigDto struct {
	ID                    uint   `json:"id"`
	Name                  string `json:"name"`
	ClientID              string `json:"client_id"`
	ClientSecret          string `json:"client_secret"`
	DisplayName           string `json:"display_name"`
	Icon                  string `json:"icon"`
	OidcDiscoveryUrl      string `json:"oidc_discovery_url"` // 自动发现url
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
	JwksUri               string `json:"jwks_uri"`
	Type                  string `json:"type"` // oauth2 or misskey
	Enabled               bool   `json:"enabled"`
}

type CreateOidcConfigDto struct {
	AdminOidcConfigDto
}

type UpdateOidcConfigDto struct {
	ID uint `json:"id" path:"id" vd:"$>0"`
	AdminOidcConfigDto
}
