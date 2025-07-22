package model

import "gorm.io/gorm"

type Session struct {
	gorm.Model
	SessionKey string `gorm:"uniqueIndex"` // 会话密钥，唯一索引
}
