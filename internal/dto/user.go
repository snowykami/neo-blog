package dto

type UserDto struct {
	ID        uint   `json:"id"`       // 用户ID
	Username  string `json:"username"` // 用户名
	Nickname  string `json:"nickname"`
	AvatarUrl string `json:"avatar_url"` // 头像URL
	Email     string `json:"email"`      // 邮箱
	Gender    string `json:"gender"`
	Role      string `json:"role"`
	Language  string `json:"language"` // 语言
}

type UserOidcConfigDto struct {
	Name        string `json:"name"`         // OIDC配置名称
	DisplayName string `json:"display_name"` // OIDC配置显示名称
	Icon        string `json:"icon"`         // OIDC配置图标URL
	LoginUrl    string `json:"login_url"`    // OIDC登录URL
}
type UserLoginReq struct {
	Username string `json:"username"` // username or email
	Password string `json:"password"`
}

type UserLoginResp struct {
	Token        string  `json:"token"`
	RefreshToken string  `json:"refresh_token"`
	User         UserDto `json:"user"`
}

type UserRegisterReq struct {
	Username         string `json:"username"`          // 用户名
	Nickname         string `json:"nickname"`          // 昵称
	Password         string `json:"password"`          // 密码
	Email            string `json:"email"`             // 邮箱
	VerificationCode string `json:"verification_code"` // 邮箱验证码
}

type UserRegisterResp struct {
	Token        string  `json:"token"`         // 访问令牌
	RefreshToken string  `json:"refresh_token"` // 刷新令牌
	User         UserDto `json:"user"`          // 用户信息
}

type VerifyEmailReq struct {
	Email string `json:"email"` // 邮箱地址
}

type VerifyEmailResp struct {
	Success bool `json:"success"` // 验证码发送成功与否
}

type OidcLoginReq struct {
	Name  string `json:"name"` // OIDC配置名称
	Code  string `json:"code"` // OIDC授权码
	State string `json:"state"`
}

type OidcLoginResp struct {
	Token        string  `json:"token"`
	RefreshToken string  `json:"refresh_token"`
	User         UserDto `json:"user"`
}

type ListOidcConfigResp struct {
	OidcConfigs []UserOidcConfigDto `json:"oidc_configs"` // OIDC配置列表
}

type GetUserReq struct {
	UserID uint `json:"user_id"`
}

type GetUserResp struct {
	User UserDto `json:"user"` // 用户信息
}

type UpdateUserReq struct {
	ID        uint   `json:"id"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	AvatarUrl string `json:"avatar_url"`
	Gender    string `json:"gender"`
}

type UpdateUserResp struct {
	User *UserDto `json:"user"` // 更新后的用户信息
}
