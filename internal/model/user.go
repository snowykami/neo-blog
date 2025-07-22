package model

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	Username  string `gorm:"uniqueIndex"` // 用户名，唯一
	Nickname  string
	AvatarUrl string
	Email     string `gorm:"uniqueIndex"`
	Gender    string
	Role      string `gorm:"default:'user'"`
	Password  string // 密码，存储加密后的值
}

func (user *User) ToDto() *dto.UserDto {
	return &dto.UserDto{
		Username:  user.Username,
		Nickname:  user.Nickname,
		AvatarUrl: user.AvatarUrl,
		Email:     user.Email,
		Gender:    user.Gender,
		Role:      user.Role,
	}
}
