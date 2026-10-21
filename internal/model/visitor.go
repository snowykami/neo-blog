package model

import (
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// Visitor 访客：一个浏览器对应一条，通过 Cookie（VisitorKey）识别，Cookie 丢失时用指纹辅助找回
type Visitor struct {
	ID           uint   `gorm:"primaryKey"`
	VisitorKey   string `gorm:"type:varchar(64);uniqueIndex;not null"` // 种在浏览器 Cookie 中的随机ID
	Fingerprint  string `gorm:"type:varchar(64);index"`                // 浏览器指纹哈希
	UserID       *uint  `gorm:"index"`                                 // 最近一次登录的用户
	User         *User  `gorm:"constraint:OnDelete:SET NULL"`
	LastIP       string `gorm:"type:varchar(64)"`
	LastLocation string `gorm:"type:varchar(128)"`
	OS           string `gorm:"type:varchar(32)"`
	Browser      string `gorm:"type:varchar(32)"`
	DeviceType   string `gorm:"type:varchar(16)"`
	VisitCount   int64
	CreatedAt    time.Time // 首次访问
	LastSeenAt   time.Time `gorm:"index"`
}

// VisitLog 访问记录：一次访问一条，保存当次的设备与位置快照
type VisitLog struct {
	ID         uint      `gorm:"primaryKey"`
	VisitorID  *uint     `gorm:"index"` // 开启“请勿追踪”时为空
	Visitor    *Visitor  `gorm:"constraint:OnDelete:SET NULL"`
	UserID     *uint     `gorm:"index"`
	User       *User     `gorm:"constraint:OnDelete:SET NULL"`
	TargetType string    `gorm:"type:varchar(16);index:idx_visit_logs_target"` // post / page / other
	TargetID   uint      `gorm:"index:idx_visit_logs_target"`
	Path       string    `gorm:"type:varchar(512)"`
	Referrer   string    `gorm:"type:varchar(512)"`
	IP         string    `gorm:"type:varchar(64)"`
	Location   string    `gorm:"type:varchar(128)"`
	UserAgent  string    `gorm:"type:text"`
	OS         string    `gorm:"type:varchar(32)"`
	Browser    string    `gorm:"type:varchar(32)"`
	DeviceType string    `gorm:"type:varchar(16)"`
	CreatedAt  time.Time `gorm:"index"`
}

func (v *Visitor) ToDto() *dto.VisitorDto {
	result := &dto.VisitorDto{
		ID:          v.ID,
		IP:          utils.MaskIP(v.LastIP),
		Location:    v.LastLocation,
		OS:          v.OS,
		Browser:     v.Browser,
		DeviceType:  v.DeviceType,
		VisitCount:  v.VisitCount,
		FirstSeenAt: v.CreatedAt,
		LastSeenAt:  v.LastSeenAt,
	}
	if v.User != nil {
		user := v.User.ToDto()
		result.User = &user
	}
	return result
}

func (l *VisitLog) ToDto() *dto.VisitLogDto {
	result := &dto.VisitLogDto{
		ID:         l.ID,
		VisitorID:  l.VisitorID,
		TargetType: l.TargetType,
		TargetID:   l.TargetID,
		Path:       l.Path,
		Referrer:   l.Referrer,
		IP:         utils.MaskIP(l.IP),
		Location:   l.Location,
		OS:         l.OS,
		Browser:    l.Browser,
		DeviceType: l.DeviceType,
		CreatedAt:  l.CreatedAt,
	}
	if l.User != nil {
		user := l.User.ToDto()
		result.User = &user
	}
	if l.Visitor != nil {
		result.VisitCount = l.Visitor.VisitCount
	}
	return result
}
