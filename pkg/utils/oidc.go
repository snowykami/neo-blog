package utils

import (
	"fmt"
)

type oidcUtils struct{}

var Oidc = oidcUtils{}

// RequestToken 请求访问令牌
func (u *oidcUtils) RequestToken(tokenEndpoint, clientID, clientSecret, code, redirectUri string) (*TokenResponse, error) {
	tokenResp, err := client.R().
		SetFormData(map[string]string{
			"grant_type":    "authorization_code",
			"client_id":     clientID,
			"client_secret": clientSecret,
			"code":          code,
			"redirect_uri":  redirectUri,
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

// RequestUserinfo 请求用户信息
func (u *oidcUtils) RequestUserinfo(userInfoEndpoint, accessToken string) (*Userinfo, error) {
	userInfoResp, err := client.R().
		SetHeader("Authorization", "Bearer "+accessToken).
		SetHeader("Accept", "application/json").
		SetResult(&Userinfo{}).
		Get(userInfoEndpoint)
	if err != nil {
		return nil, err
	}

	if userInfoResp.StatusCode() != 200 {
		return nil, fmt.Errorf("状态码: %d，响应: %s", userInfoResp.StatusCode(), userInfoResp.String())
	}

	return userInfoResp.Result().(*Userinfo), nil
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	IDToken      string `json:"id_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

// Userinfo 定义用户信息结构
type Userinfo struct {
	Sub               string   `json:"sub"`
	Name              string   `json:"name"`
	Email             string   `json:"email"`
	Picture           string   `json:"picture,omitempty"`
	PreferredUsername string   `json:"preferred_username"`
	Groups            []string `json:"groups,omitempty"` // 可选字段，OIDC提供的用户组信息
}
