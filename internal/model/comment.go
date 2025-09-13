package model

import (
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

type Comment struct {
	gorm.Model
	UserID         uint   `gorm:"index"`                           // 评论的用户ID
	User           User   `gorm:"foreignKey:UserID;references:ID"` // 关联的用户
	TargetID       uint   `gorm:"index"`                           // 目标ID
	TargetType     string `gorm:"index"`                           // 目标类型，如 "post", "page"
	ReplyID        uint   `gorm:"index"`                           // 回复的评论ID
	Content        string `gorm:"type:text"`                       // 评论内容
	Depth          int    `gorm:"default:0"`                       // 评论的层级深度,从0开始计数
	IsPrivate      bool   `gorm:"default:false"`                   // 是否为私密评论，私密评论只有评论者和被评论对象所有者可见
	RemoteAddr     string `gorm:"type:text"`                       // 远程地址
	UserAgent      string `gorm:"type:text"`
	Location       string `gorm:"type:text"` // 用户位置，基于IP
	LikeCount      uint64
	CommentCount   uint64
	ShowClientInfo bool `gorm:"default:false"` // 是否显示客户端信息
}

func (c *Comment) AfterCreate(tx *gorm.DB) (err error) {
	// 更新评论IP
	return tx.Model(c).Update("Location", utils.GetLocationString(c.RemoteAddr)).Error
}
