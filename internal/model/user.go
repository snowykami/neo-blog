package model

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	Username       string `gorm:"uniqueIndex;not null"` // 用户名，唯一
	Nickname       string `gorm:"default:''"`           // 昵称
	AvatarUrl      string
	BackgroundUrl  string
	PreferredColor string        `gorm:"default:''"` // 主题色
	Email          string        `gorm:"uniqueIndex"`
	Gender         string        `gorm:"default:''"`     // 性别：male / female 为标准取值，其余非空内容为自定义文字，空表示不填
	Role           constant.Role `gorm:"default:'user'"` // user editor admin
	Language       string        `gorm:"default:'zh'"`
	Password       string        // 密码，存储加密后的值
	ShowIPLocation *bool         `gorm:"default:true"`  // 是否显示IP归属地
	ShowLikes      *bool         `gorm:"default:false"` // 是否公开点赞记录，默认不公开
	ShowLocalTime  *bool         `gorm:"default:false"` // 是否在主页公开当地时间，默认不公开
	TimeZone       string        `gorm:"default:''"`    // IANA 时区，只在公开当地时间时保存，关闭时清空
	Disabled       bool          `gorm:"default:false"` // 是否被管理员禁用，禁用后无法登录且已有会话失效
	IsAI           bool          `gorm:"default:false"` // 是否为 AI 用户：由 Agent 驱动、与普通用户同权限，不能密码登录
	// AI 写作的语言习惯：作者描述自己的口吻，编辑器 AI 写作与 MCP 写作指南会附上；只有本人可读写，不放进任何用户 DTO
	AIWritingHabit string `gorm:"type:text;default:''"`
	// 通知偏好（JSON 文本，空表示全默认）：站内 / 邮件允许的类型与 AI 互动开关，只有本人可读写
	NotificationPrefs string `gorm:"type:text;default:''"`
}

// ToDto 公开的用户信息，不包含邮箱等隐私字段
func (user *User) ToDto() dto.UserDto {
	return dto.UserDto{
		ID:             user.ID,
		Username:       user.Username,
		Nickname:       user.Nickname,
		AvatarUrl:      user.AvatarUrl,
		BackgroundUrl:  user.BackgroundUrl,
		PreferredColor: user.PreferredColor,
		Gender:         user.Gender,
		Role:           user.Role,
		Language:       user.Language,
		ShowIPLocation: user.ShowIPLocation,
		ShowLikes:      user.ShowLikes,
		ShowLocalTime:  user.ShowLocalTime,
		GravatarHash:   gravatarHash(user.Email),
	}
}

// ToBriefDto 提及候选用的最小信息：不带邮箱哈希、角色等字段，避免被拿去反推账号
func (user *User) ToBriefDto() dto.UserBriefDto {
	return dto.UserBriefDto{
		ID:        user.ID,
		Username:  user.Username,
		Nickname:  user.Nickname,
		AvatarUrl: user.AvatarUrl,
		IsAI:      user.IsAI,
	}
}

// ToProfileDto 个人主页使用的公开信息：用户开启「公开当地时间」后才附带时区，评论、文章作者等其他场景不返回
func (user *User) ToProfileDto() dto.UserDto {
	userDto := user.ToDto()
	if user.ShowLocalTime != nil && *user.ShowLocalTime {
		userDto.TimeZone = user.TimeZone
	}
	return userDto
}

// gravatarHash 按 Gravatar 规范对邮箱（去空白、转小写）做 SHA-256，所有场景的默认头像都以此为准，保证同一用户处处一致
func gravatarHash(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(email))
	return hex.EncodeToString(sum[:])
}

// ToPrivateDto 包含邮箱的完整用户信息，只返回给本人和管理员
func (user *User) ToPrivateDto() dto.UserDto {
	userDto := user.ToProfileDto()
	userDto.Email = user.Email
	userDto.CreatedAt = &user.CreatedAt
	userDto.Disabled = &user.Disabled
	userDto.IsAI = &user.IsAI
	return userDto
}

func (user *User) IsAdmin() bool {
	return user.Role == constant.RoleAdmin
}

func (user *User) IsEditor() bool {
	return user.Role == constant.RoleEditor
}

func (user *User) GreaterThanEditor() bool {
	return user.Role == constant.RoleAdmin || user.Role == constant.RoleEditor
}

type UserOpenID struct {
	gorm.Model
	UserID            uint   `gorm:"index"`
	User              User   `gorm:"foreignKey:UserID;references:ID"`
	Issuer            string `gorm:"index"` // OIDC Issuer
	Sub               string `gorm:"index"` // OIDC Sub openid
	Name              string // 昵称，以下每次登录会更新
	Email             string // 邮箱
	Picture           string // 头像
	PreferredUsername string // 用户名
	// 不储存字段，每次获取时赋值
	OidcName        string `gorm:"-"` // 关联的OIDC配置名称
	OidcDisplayName string `gorm:"-"` // 关联的OIDC配置显示名称
	OidcIcon        string `gorm:"-"` // 关联的OIDC配置图标
}

func (uo *UserOpenID) ToDto() dto.UserOpenIDDto {
	return dto.UserOpenIDDto{
		ID:                uo.ID,
		UserID:            uo.UserID,
		Issuer:            uo.Issuer,
		Sub:               uo.Sub,
		Name:              uo.Name,
		Email:             uo.Email,
		Picture:           uo.Picture,
		PreferredUsername: uo.PreferredUsername,
		OidcName:          uo.OidcName,
		OidcIcon:          uo.OidcIcon,
		OidcDisplayName:   uo.OidcDisplayName,
	}
}

// ToAdminUserDtos 管理后台使用，包含邮箱；公开接口一律用 ToPublicUserDtos
func ToAdminUserDtos(users []User) []dto.UserDto {
	dtos := make([]dto.UserDto, len(users))
	for i, u := range users {
		dtos[i] = u.ToPrivateDto()
	}
	return dtos
}

// ToPublicUserDtos 公开的用户信息列表，不包含邮箱等隐私字段
func ToPublicUserDtos(users []User) []dto.UserDto {
	dtos := make([]dto.UserDto, len(users))
	for i, u := range users {
		dtos[i] = u.ToDto()
	}
	return dtos
}

func ToOpenIdDtos(oidcs []UserOpenID) []dto.UserOpenIDDto {
	dtos := make([]dto.UserOpenIDDto, len(oidcs))
	for i, o := range oidcs {
		dtos[i] = o.ToDto()
	}
	return dtos
}
