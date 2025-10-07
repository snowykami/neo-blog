package dto

type UserDto struct {
	ID             uint   `json:"id"`       // 用户ID
	Username       string `json:"username"` // 用户名
	Nickname       string `json:"nickname"`
	AvatarUrl      string `json:"avatar_url"` // 头像URL
	BackgroundUrl  string `json:"background_url"`
	PreferredColor string `json:"preferred_color"` // 主题色
	Email          string `json:"email"`           // 邮箱
	Gender         string `json:"gender"`
	Role           string `json:"role"`
	Language       string `json:"language"` // 语言
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
	Username string `json:"username"` // 用户名
	Nickname string `json:"nickname"` // 昵称
	Password string `json:"password"` // 密码
	Email    string `header:"X-Email" json:"-" binding:"-"`
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
	Name         string `path:"name" validate:"required"`
	Code         string `query:"code" validate:"required"`
	State        string `query:"state"`
	RedirectBack string `query:"redirect_back" default:"/"` // 这是个非标的，前端REPLACE填充生成的
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

type GetUserByUsernameReq struct {
	Username string `json:"username"`
}

type GetUserResp struct {
	User UserDto `json:"user"` // 用户信息
}

type UpdateUserReq struct {
	ID             uint   `path:"id" vd:"$>0"`
	Username       string `json:"username"`
	Nickname       string `json:"nickname"`
	AvatarUrl      string `json:"avatar_url"`
	BackgroundUrl  string `json:"background_url"`
	PreferredColor string `json:"preferred_color"`
	Gender         string `json:"gender"`
	Language       string `json:"language"`
}

type UpdateUserResp struct {
	User *UserDto `json:"user"` // 更新后的用户信息
}

type UpdatePasswordReq struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

type ResetPasswordReq struct {
	Email       string `json:"-" binding:"-"`
	NewPassword string `json:"new_password"`
}
