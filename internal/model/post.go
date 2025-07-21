package model

import "gorm.io/gorm"

type Post struct {
	gorm.Model
	UserID  uint    `gorm:"index"`                                                                // 发布者的用户ID
	User    User    `gorm:"foreignKey:UserID;references:ID"`                                      // 关联的用户
	Title   string  `gorm:"type:text;not null"`                                                   // 帖子标题
	Content string  `gorm:"type:text;not null"`                                                   // 帖子内容
	Labels  []Label `gorm:"many2many:post_labels;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"` // 关联的标签
}
