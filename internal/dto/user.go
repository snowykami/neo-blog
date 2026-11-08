package dto

import (
	"time"

	"github.com/snowykami/neo-blog/pkg/constant"
)

type UserDto struct {
	ID             uint          `json:"id"`       // 用户ID
	Username       string        `json:"username"` // 用户名
	Nickname       string        `json:"nickname"`
	AvatarUrl      string        `json:"avatar_url"` // 头像URL
	BackgroundUrl  string        `json:"background_url"`
	PreferredColor string        `json:"preferred_color"`         // 主题色
	Email          string        `json:"email,omitempty"`         // 邮箱，仅本人和管理员可见
	GravatarHash   string        `json:"gravatar_hash,omitempty"` // 邮箱的 SHA-256 哈希，用于生成 Gravatar 头像，不暴露邮箱本身
	Gender         string        `json:"gender"`
	Role           constant.Role `json:"role"`
	Language       string        `json:"language"`             // 语言
	ShowIPLocation *bool         `json:"show_ip_location"`     // 是否显示IP归属地
	ShowLikes      *bool         `json:"show_likes"`           // 是否公开点赞记录
	ShowLocalTime  *bool         `json:"show_local_time"`      // 是否公开当地时间
	TimeZone       string        `json:"time_zone,omitempty"`  // IANA 时区，只在个人主页且用户公开当地时间时返回
	CreatedAt      *time.Time    `json:"created_at,omitempty"` // 注册时间，仅本人和管理员可见
	Disabled       *bool         `json:"disabled,omitempty"`   // 是否被禁用，仅本人和管理员可见
	IsAI           *bool         `json:"is_ai,omitempty"`      // 是否为 AI 用户，仅本人和管理员可见；前台不做区分
}

type UserOidcConfigDto struct {
	Name        string `json:"name"`         // OIDC配置名称
	DisplayName string `json:"display_name"` // OIDC配置显示名称
	Icon        string `json:"icon"`         // OIDC配置图标URL
}
type UserLoginReq struct {
	Username   string `json:"username"` // username or email
	Password   string `json:"password"`
	RememberMe bool   `json:"remember_me" default:"false"`
	UserIP     string
}

type UserLoginResp struct {
	Token        string  `json:"token"`
	RefreshToken string  `json:"refresh_token"`
	User         UserDto `json:"user"`
}

type UserRegisterReq struct {
	Username   string `json:"username"` // 用户名
	Nickname   string `json:"nickname"` // 昵称
	Password   string `json:"password"` // 密码
	Email      string `header:"X-Email" json:"-" binding:"-"`
	VerifyCode string `header:"X-VerifyCode" json:"-" binding:"-"`
	UserIP     string
}

type UserRegisterResp struct {
	Token        string  `json:"token"`         // 访问令牌
	RefreshToken string  `json:"refresh_token"` // 刷新令牌
	User         UserDto `json:"user"`          // 用户信息
}

type VerifyEmailReq struct {
	Email  string `json:"email"` // 邮箱地址
	UserIP string `json:"-"`
}

type VerifyEmailResp struct {
	Success bool `json:"success"` // 验证码发送成功与否
}

type OidcLoginReq struct {
	Name         string `path:"name" validate:"required"`
	Code         string `query:"code"`
	State        string `query:"state" validate:"required"`
	Error        string `query:"error"`
	ErrorDesc    string `query:"error_description"`
	RedirectBack string // 从state恢复的前端回跳地址
	IsBind       bool   // 从state恢复的绑定操作标记
	Session      string `query:"session"` // Misskey，绑定操作时的session
	UserIP       string
	BrowserNonce string // 浏览器 Cookie 中的 OIDC nonce，用于确认回调来自发起登录的同一浏览器
	BindUserID   uint   // 从state恢复的发起绑定的用户ID
	CodeVerifier string // 从state恢复的 PKCE code_verifier
}

type OidcLoginResp struct {
	Token        string  `json:"token"`
	RefreshToken string  `json:"refresh_token"`
	User         UserDto `json:"user"`
}

// OidcAuthorizeReq 点击第三方登录时由浏览器直接访问，state 在此时生成
type OidcAuthorizeReq struct {
	Name         string `path:"name"`
	RedirectBack string `query:"redirect_back"` // OIDC完成后回跳到前端的地址
	IsBind       bool   `query:"bind"`          // 是否是绑定操作，需已登录
	BrowserNonce string // 写入浏览器 Cookie 的 nonce
	UserID       uint   // 绑定操作的发起用户
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

// UserBriefDto 提及候选用的最小用户信息：不含邮箱哈希等可用于反推邮箱的字段
type UserBriefDto struct {
	ID        uint   `json:"id"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	AvatarUrl string `json:"avatar_url"`
	IsAI      bool   `json:"is_ai"`
}

// SearchUsersReq 提及功能里的用户搜索：按用户名 / 昵称模糊匹配
type SearchUsersReq struct {
	Query string `query:"q"`
	Limit int    `query:"limit" default:"8"` // 最多返回几个候选
}

type GetUserResp struct {
	User UserDto `json:"user"` // 用户信息
}

type UpdateUserReq struct {
	ID             uint    `path:"id" vd:"$>0"`
	Username       string  `json:"username"`
	Nickname       string  `json:"nickname"`
	AvatarUrl      string  `json:"avatar_url"`
	BackgroundUrl  string  `json:"background_url"`
	PreferredColor string  `json:"preferred_color"`
	Gender         *string `json:"gender"` // 为空表示不修改；空字符串表示清空
	Language       string  `json:"language"`
	ShowIPLocation *bool   `json:"show_ip_location"`
	ShowLikes      *bool   `json:"show_likes"`
	ShowLocalTime  *bool   `json:"show_local_time"` // 为空表示不修改；关闭时一并清空时区
	TimeZone       string  `json:"time_zone"`       // 公开当地时间时必填的 IANA 时区
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

// AdminListUsersReq 管理员用户列表筛选参数
type AdminListUsersReq struct {
	PaginationParams
	Keyword string `query:"keyword"` // 按用户名、昵称、邮箱模糊搜索
	Role    string `query:"role"`    // 按角色筛选，为空表示全部
	Status  string `query:"status"`  // active / disabled，为空表示全部
}

// AdminUserDetailResp 管理员查看的用户详情，附带内容统计，用于删除前提示影响范围
type AdminUserDetailResp struct {
	User         UserDto `json:"user"`
	PostCount    int64   `json:"post_count"`
	PageCount    int64   `json:"page_count"`
	CommentCount int64   `json:"comment_count"`
}

type AdminCreateUserReq struct {
	Username string        `json:"username"`
	Nickname string        `json:"nickname"`
	Email    string        `json:"email"`
	Password string        `json:"password"`
	Role     constant.Role `json:"role"`
}

// AdminUpdateUserReq 管理员编辑用户资料，所有字段整体覆盖，允许清空可选字段
type AdminUpdateUserReq struct {
	ID            uint   `path:"id" vd:"$>0"`
	Username      string `json:"username"`
	Nickname      string `json:"nickname"`
	Email         string `json:"email"`
	AvatarUrl     string `json:"avatar_url"`
	BackgroundUrl string `json:"background_url"`
	Gender        string `json:"gender"`
}

type AdminUpdateUserRoleReq struct {
	ID   uint          `path:"id" vd:"$>0"`
	Role constant.Role `json:"role"`
}

type AdminUpdateUserStatusReq struct {
	ID       uint `path:"id" vd:"$>0"`
	Disabled bool `json:"disabled"`
}

type AdminResetUserPasswordReq struct {
	ID          uint   `path:"id" vd:"$>0"`
	NewPassword string `json:"new_password"`
}
