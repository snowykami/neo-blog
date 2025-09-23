package model

import (
  "github.com/snowykami/neo-blog/internal/dto"
  "gorm.io/gorm"
)

type User struct {
  gorm.Model
  Username  string `gorm:"uniqueIndex;not null"` // 用户名，唯一
  Nickname  string `gorm:"default:''"`           // 昵称
  AvatarUrl string
  Email     string `gorm:"uniqueIndex"`
  Gender    string `gorm:"default:''"`
  Role      string `gorm:"default:'user'"` // user editor admin
  Language  string `gorm:"default:'en'"`
  Password  string // 密码，存储加密后的值
}

type UserOpenID struct {
  gorm.Model
  UserID uint   `gorm:"index"`
  User   User   `gorm:"foreignKey:UserID;references:ID"`
  Issuer string `gorm:"index"` // OIDC Issuer
  Sub    string `gorm:"index"` // OIDC Sub openid
}

func (user *User) ToDto() dto.UserDto {
  return dto.UserDto{
    ID:        user.ID,
    Username:  user.Username,
    Nickname:  user.Nickname,
    AvatarUrl: user.AvatarUrl,
    Email:     user.Email,
    Gender:    user.Gender,
    Role:      user.Role,
    Language:  user.Language,
  }
}
