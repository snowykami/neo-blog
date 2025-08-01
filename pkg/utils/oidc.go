package utils

import (
	"fmt"
	"resty.dev/v3"
)

type oidcUtils struct{}

var Oidc = oidcUtils{}

// RequestToken 请求访问令牌
func (u *oidcUtils) RequestToken(tokenEndpoint, clientID, clientSecret, code, redirectURI string) (*TokenResponse, error) {
	client := resty.New()
	tokenResp, err := client.R().
		SetFormData(map[string]string{
			"grant_type":    "authorization_code",
			"client_id":     clientID,
			"client_secret": clientSecret,
			"code":          code,
			"redirect_uri":  redirectURI,
		}).
		SetHeader("Accept", "application/json").
		SetResult(&TokenResponse{}).
		Post(tokenEndpoint)

	if err != nil {
		return nil, err
	}

	if tokenResp.StatusCode() != 200 {
		return nil, fmt.Errorf("状态码: %d，响应: %s", tokenResp.StatusCode(), tokenResp.String())
	}
	return tokenResp.Result().(*TokenResponse), nil
}

// RequestUserInfo 请求用户信息
func (u *oidcUtils) RequestUserInfo(userInfoEndpoint, accessToken string) (*UserInfo, error) {
	client := resty.New()
	userInfoResp, err := client.R().
		SetHeader("Authorization", "Bearer "+accessToken).
		SetHeader("Accept", "application/json").
		SetResult(&UserInfo{}).
		Get(userInfoEndpoint)
	if err != nil {
		return nil, err
	}

	if userInfoResp.StatusCode() != 200 {
		return nil, fmt.Errorf("状态码: %d，响应: %s", userInfoResp.StatusCode(), userInfoResp.String())
	}

	return userInfoResp.Result().(*UserInfo), nil
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	IDToken      string `json:"id_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

// UserInfo 定义用户信息结构
type UserInfo struct {
	Sub     string   `json:"sub"`
	Name    string   `json:"name"`
	Email   string   `json:"email"`
	Picture string   `json:"picture,omitempty"`
	Groups  []string `json:"groups,omitempty"` // 可选字段，OIDC提供的用户组信息
}
