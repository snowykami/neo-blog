package model

import "gorm.io/gorm"

type Comment struct {
	gorm.Model
	UserID       uint   `gorm:"index"`                           // 评论的用户ID
	User         User   `gorm:"foreignKey:UserID;references:ID"` // 关联的用户
	TargetID     uint   `gorm:"index"`                           // 目标ID
	TargetType   string `gorm:"index"`                           // 目标类型，如 "post", "page"
	ReplyID      uint   `gorm:"index"`                           // 回复的评论ID
	Content      string `gorm:"type:text"`                       // 评论内容
	Depth        int    `gorm:"default:0"`                       // 评论的层级深度
	LikeCount    uint64
	CommentCount uint64
}
