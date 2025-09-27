package dto

type AdminOidcConfigDto struct {
	ID               uint   `json:"id" path:"id" vd:"$>0"`
	Name             string `json:"name"`
	ClientID         string `json:"client_id"`
	ClientSecret     string `json:"client_secret"`
	DisplayName      string `json:"display_name"`
	Icon             string `json:"icon"`
	OidcDiscoveryUrl string `json:"oidc_discovery_url"`
	Type             string `json:"type"` // oauth2 or misskey
	Enabled          bool   `json:"enabled"`
}
