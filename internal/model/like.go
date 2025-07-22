package model

import (
	"fmt"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

type Like struct {
	gorm.Model
	TargetType string
	TargetID   uint
	UserID     uint
}

// AfterCreate 点赞后更新被点赞对象的计数
func (l *Like) AfterCreate(tx *gorm.DB) (err error) {
	switch l.TargetType {
	case constant.TargetTypePost:
		return tx.Model(&Post{}).Where("id = ?", l.TargetID).
			UpdateColumn("like_count", gorm.Expr("like_count + ?", 1)).Error
	case constant.TargetTypeComment:
		return tx.Model(&Comment{}).Where("id = ?", l.TargetID).
			UpdateColumn("like_count", gorm.Expr("like_count + ?", 1)).Error
	default:
		return fmt.Errorf("不支持的目标类型: %s", l.TargetType)
	}
}

// AfterDelete 取消点赞后更新被点赞对象的计数
func (l *Like) AfterDelete(tx *gorm.DB) (err error) {
	switch l.TargetType {
	case constant.TargetTypePost:
		return tx.Model(&Post{}).Where("id = ?", l.TargetID).
			UpdateColumn("like_count", gorm.Expr("GREATEST(like_count - ?, 0)", 1)).Error
	case constant.TargetTypeComment:
		return tx.Model(&Comment{}).Where("id = ?", l.TargetID).
			UpdateColumn("like_count", gorm.Expr("GREATEST(like_count - ?, 0)", 1)).Error
	default:
		return fmt.Errorf("不支持的目标类型: %s", l.TargetType)
	}
}
