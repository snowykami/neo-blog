package dto

type UserDto struct {
	Username  string `json:"username"` // 用户名
	Nickname  string `json:"nickname"`
	AvatarUrl string `json:"avatar_url"` // 头像URL
	Email     string `json:"email"`      // 邮箱
	Gender    string `json:"gender"`
	Role      string `json:"role"`
}
type UserLoginReq struct {
	Username string `json:"username"` // username or email
	Password string `json:"password"`
}

type UserLoginResp struct {
	Token        string   `json:"token"`
	RefreshToken string   `json:"refresh_token"`
	User         *UserDto `json:"user"`
}

type UserRegisterReq struct {
	Username string `json:"username"` // 用户名
	Nickname string `json:"nickname"` // 昵称
	Password string `json:"password"` // 密码
	Email    string `json:"email"`    // 邮箱
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
