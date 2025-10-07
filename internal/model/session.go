package model

import "gorm.io/gorm"

type Session struct {
	gorm.Model
	UserID    uint   // 关联的用户ID
	SessionID string `gorm:"uniqueIndex"` // 会话密钥，唯一索引
	UserIP    string // 用户IP
}
