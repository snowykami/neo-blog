package utils

import (
	"fmt"
)

type oidcUtils struct{}

var Oidc = oidcUtils{}

// RequestToken 请求访问令牌
func (u *oidcUtils) RequestToken(tokenEndpoint, clientID, clientSecret, code, redirectUri string) (*TokenResponse, error) {
	tokenResp := TokenResponse{}
	resp, err := client.R().
		SetFormData(map[string]string{
			"grant_type":    "authorization_code",
			"client_id":     clientID,
			"client_secret": clientSecret,
			"code":          code,
			"redirect_uri":  redirectUri,
		}).
		SetHeader("Accept", "application/json").
		SetResult(&tokenResp).
		Post(tokenEndpoint)

	if err != nil {
		return nil, err
	}
	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("状态码: %d，响应: %s", resp.StatusCode(), resp.String())
	}
	return &tokenResp, nil
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

// RequestUserEmails 请求用户邮箱列表（适用于GitHub等需要单独请求邮箱的OIDC提供商）
func (u *oidcUtils) RequestUserEmails(emailsEndpoint, accessToken string) ([]string, error) {
	var emails []struct {
		Email      string `json:"email"`
		Primary    bool   `json:"primary"`
		Verified   bool   `json:"verified"`
		Visibility string `json:"visibility"`
	}

	resp, err := client.R().
		SetHeader("Authorization", "Bearer "+accessToken).
		SetHeader("Accept", "application/vnd.github+json").
		SetResult(&emails).
		Get(emailsEndpoint)

	if err != nil {
		return nil, err
	}

	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("状态码: %d，响应: %s", resp.StatusCode(), resp.String())
	}

	emailList := make([]string, 0)
	for _, e := range emails {
		if e.Verified {
			emailList = append(emailList, e.Email)
		}
	}

	return emailList, nil
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	IDToken      string `json:"id_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Error        string `json:"error,omitempty"`
}

// Userinfo 定义用户信息结构
type Userinfo struct {
	ID                int64    `json:"id"`    // GitHub兜底字段，OIDC标准没有定义ID字段
	Login             string   `json:"login"` // GitHub兜底字段，OIDC标准没有定义Login字段
	Sub               string   `json:"sub"`
	Name              string   `json:"name"`
	Email             string   `json:"email"`
	Picture           string   `json:"picture,omitempty"`
	PreferredUsername string   `json:"preferred_username"`
	Groups            []string `json:"groups,omitempty"` // 可选字段，OIDC提供的用户组信息
}
