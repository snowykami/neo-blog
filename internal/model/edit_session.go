package model

import (
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// EditSession 编辑会话：同一文章/页面同时只有最新打开编辑页的会话可以保存正文
// 新的编辑会话会覆盖旧记录（顶掉旧会话），旧会话仍可重新进入编辑页接管
type EditSession struct {
	TargetType string `gorm:"primaryKey;type:varchar(16)"` // 目标类型：post / page
	TargetID   uint   `gorm:"primaryKey"`                  // 目标ID
	SessionID  string `gorm:"type:varchar(64);not null"`   // 编辑会话ID
	UserID     uint   // 开启会话的用户
	User       User   `gorm:"foreignKey:UserID;references:ID"`
	UserAgent  string `gorm:"type:text"` // 开启会话的设备
	UpdatedAt  time.Time
}

// ToDto 转换为 DTO，withSessionID 仅在申请会话时返回给申请者
func (e *EditSession) ToDto(withSessionID bool) *dto.EditSessionDto {
	ua := utils.ParseUA(e.UserAgent)
	result := &dto.EditSessionDto{
		User:      e.User.ToDto(),
		OS:        ua.OS,
		Browser:   ua.Browser,
		StartedAt: e.UpdatedAt,
	}
	if withSessionID {
		result.SessionID = e.SessionID
	}
	return result
}
