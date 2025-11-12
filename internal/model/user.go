package model

import (
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
	Gender         string        `gorm:"default:''"`
	Role           constant.Role `gorm:"default:'user'"` // user editor admin
	Language       string        `gorm:"default:'zh'"`
	Password       string        // 密码，存储加密后的值
	ShowIPLocation *bool         `gorm:"default:true"` // 是否显示IP归属地
}

func (user *User) ToDto() dto.UserDto {
	return dto.UserDto{
		ID:             user.ID,
		Username:       user.Username,
		Nickname:       user.Nickname,
		AvatarUrl:      user.AvatarUrl,
		BackgroundUrl:  user.BackgroundUrl,
		PreferredColor: user.PreferredColor,
		Email:          user.Email,
		Gender:         user.Gender,
		Role:           user.Role,
		Language:       user.Language,
		ShowIPLocation: user.ShowIPLocation,
	}
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

func ToUserDtos(users []User) []dto.UserDto {
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
