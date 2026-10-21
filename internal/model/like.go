package model

import (
	"gorm.io/gorm"
)

type Like struct {
	gorm.Model
	TargetType string `gorm:"uniqueIndex:idx_like_target_user"` // 同一用户对同一目标只能有一条点赞
	TargetID   uint   `gorm:"uniqueIndex:idx_like_target_user"`
	UserID     uint   `gorm:"uniqueIndex:idx_like_target_user"`
	User       User   `gorm:"foreignKey:UserID"`
}
