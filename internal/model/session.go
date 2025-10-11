package model

import (
	"strings"

	"gorm.io/gorm"
)

type Session struct {
	gorm.Model
	UserID    uint   // 关联的用户ID
	SessionID string `gorm:"uniqueIndex"` // 会话密钥，唯一索引
	UserIP    string // 用户IP，格式为timestamp,ip;timestamp,ip;...
}

type IPRecord struct {
	Timestamp string
	IP        string
}

func (s *Session) DecodeIPRecords() []IPRecord {
	records := []IPRecord{}
	if s.UserIP == "" {
		return records
	}
	entries := strings.Split(s.UserIP, ";")
	for _, entry := range entries {
		if entry == "" {
			continue
		}
		parts := strings.SplitN(entry, ",", 2)
		if len(parts) != 2 {
			continue
		}
		records = append(records, IPRecord{
			Timestamp: parts[0],
			IP:        parts[1],
		})
	}
	return records
}

func (s *Session) LatestIP() string {
	records := s.DecodeIPRecords()
	if len(records) == 0 {
		return ""
	}
	return records[len(records)-1].IP
}
