package model

import "gorm.io/gorm"

type User struct {
	gorm.Model
	Username  string `gorm:"unique;index"` // 用户名，唯一
	Nickname  string
	AvatarUrl string
	Email     string `gorm:"unique;index"`
	Gender    string
	Role      string `gorm:"default:'user'"`

	Password string // 密码，存储加密后的值
}
