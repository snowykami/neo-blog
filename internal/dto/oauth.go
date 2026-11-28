package dto

// ---- 元数据发现响应（RFC 9728 & RFC 8414，直接输出标准 JSON） ----

type OAuthProtectedResourceMetadata struct {
	Resource               string   `json:"resource"`
	AuthorizationServers   []string `json:"authorization_servers"`
	ScopesSupported        []string `json:"scopes_supported"`
	BearerMethodsSupported []string `json:"bearer_methods_supported"`
}

type OAuthAuthorizationServerMetadata struct {
	Issuer                                     string   `json:"issuer"`
	AuthorizationEndpoint                      string   `json:"authorization_endpoint"`
	TokenEndpoint                              string   `json:"token_endpoint"`
	RegistrationEndpoint                       string   `json:"registration_endpoint"`
	RevocationEndpoint                         string   `json:"revocation_endpoint"`
	ResponseTypesSupported                     []string `json:"response_types_supported"`
	GrantTypesSupported                        []string `json:"grant_types_supported"`
	TokenEndpointAuthMethodsSupported          []string `json:"token_endpoint_auth_methods_supported"`
	CodeChallengeMethodsSupported              []string `json:"code_challenge_methods_supported"`
	ScopesSupported                            []string `json:"scopes_supported"`
	AuthorizationResponseIssParameterSupported bool     `json:"authorization_response_iss_parameter_supported"`
}

// ---- 动态客户端注册（RFC 7591，直接输出标准 JSON） ----

type OAuthClientRegistrationReq struct {
	RedirectURIs            []string `json:"redirect_uris"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
	ClientName              string   `json:"client_name"`
	ClientURI               string   `json:"client_uri"`
	LogoURI                 string   `json:"logo_uri"`
	Scope                   string   `json:"scope"`
}

type OAuthClientRegistrationResp struct {
	ClientID                string   `json:"client_id"`
	ClientSecret            string   `json:"client_secret,omitempty"`
	ClientIDIssuedAt        int64    `json:"client_id_issued_at"`
	ClientSecretExpiresAt   *int64   `json:"client_secret_expires_at,omitempty"`
	RedirectURIs            []string `json:"redirect_uris"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
	ClientName              string   `json:"client_name"`
	ClientURI               string   `json:"client_uri,omitempty"`
	LogoURI                 string   `json:"logo_uri,omitempty"`
	Scope                   string   `json:"scope,omitempty"`
}

// ---- 浏览器授权页内部接口（走 resps 响应封装，供 Next.js /oauth/authorize 页面调用） ----

type OAuthAuthorizeInfoReq struct {
	ClientID            string `query:"client_id"`
	RedirectURI         string `query:"redirect_uri"`
	ResponseType        string `query:"response_type"`
	Scope               string `query:"scope"`
	State               string `query:"state"`
	CodeChallenge       string `query:"code_challenge"`
	CodeChallengeMethod string `query:"code_challenge_method"`
	Resource            string `query:"resource"`
}

type OAuthAuthorizeInfoResp struct {
	ClientID          string   `json:"client_id"`
	ClientName        string   `json:"client_name"`
	ClientURI         string   `json:"client_uri"`
	LogoURI           string   `json:"logo_uri"`
	RedirectURI       string   `json:"redirect_uri"`
	CallbackTarget    string   `json:"callback_target"`
	RequestedScopes   []string `json:"requested_scopes"`
	GrantedScopes     []string `json:"granted_scopes"`
	UnavailableScopes []string `json:"unavailable_scopes"`
}

type OAuthAuthorizeDecisionReq struct {
	Approve             bool     `json:"approve"`
	ClientID            string   `json:"client_id"`
	RedirectURI         string   `json:"redirect_uri"`
	ResponseType        string   `json:"response_type"`
	Scope               string   `json:"scope"`
	Scopes              []string `json:"scopes"`
	State               string   `json:"state"`
	CodeChallenge       string   `json:"code_challenge"`
	CodeChallengeMethod string   `json:"code_challenge_method"`
	Resource            string   `json:"resource"`
}

type OAuthAuthorizeDecisionResp struct {
	RedirectURL string `json:"redirect_url"`
}

// ---- 令牌换取与吊销（RFC 6749 & RFC 7009，直接输出标准 JSON） ----

type OAuthTokenReq struct {
	GrantType    string `json:"grant_type"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	Code         string `json:"code"`
	RedirectURI  string `json:"redirect_uri"`
	CodeVerifier string `json:"code_verifier"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	Resource     string `json:"resource"`
}

type OAuthTokenResp struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope"`
}

type OAuthRevokeReq struct {
	Token         string `json:"token"`
	TokenTypeHint string `json:"token_type_hint"`
	ClientID      string `json:"client_id"`
	ClientSecret  string `json:"client_secret"`
}

type OAuthErrorResp struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description,omitempty"`
}
