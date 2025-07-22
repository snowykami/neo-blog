package dto

type AdminOidcConfigDto struct {
	ID               uint   `json:"id"`
	Name             string `json:"name"`
	ClientID         string `json:"client_id"`
	ClientSecret     string `json:"client_secret"`
	DisplayName      string `json:"display_name"`
	Icon             string `json:"icon"`
	OidcDiscoveryUrl string `json:"oidc_discovery_url"`
	Enabled          bool   `json:"enabled"`
}
