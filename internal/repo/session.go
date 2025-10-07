package repo

import (
	"fmt"
	"net"
	"strings"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

type sessionRepo struct{}

var Session = sessionRepo{}

func (s *sessionRepo) CreateSession(session *model.Session) error {
	return db.Create(session).Error
}

func (s *sessionRepo) IsSessionValid(sessionID string) (bool, error) {
	var count int64
	err := db.Model(&model.Session{}).Where("session_id = ?", sessionID).Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *sessionRepo) RevokeSession(sessionID string) error {
	// 硬删除，误删大不了重新登录
	return db.Unscoped().Where("session_id = ?", sessionID).Delete(&model.Session{}).Error
}

// 在UserIP字段添加一条新的IP记录，记录格式为 "ip,timestamp;"
func (s *sessionRepo) AddSessionIPRecord(sessionID string, ip string) error {
	entry := utils.NewIPRecord(ip) // {timestamp},{ip};
	return db.Model(&model.Session{}).
		Where("session_id = ?", sessionID).
		UpdateColumn("user_ip", gorm.Expr("CONCAT_WS('', COALESCE(user_ip, ''), ?)", entry)).Error
}

func (s *sessionRepo) GetSessionLastIP(sessionID string) (string, error) {
	var session model.Session
	if err := db.Select("user_ip").Where("session_id = ?", sessionID).First(&session).Error; err != nil {
		return "", err
	}

	up := strings.TrimSpace(session.UserIP)
	if up == "" {
		return "", nil
	}

	trimmed := strings.TrimRight(up, ";")
	if trimmed == "" {
		return "", nil
	}
	records := strings.Split(trimmed, ";")
	lastRecord := strings.TrimSpace(records[len(records)-1])

	// 期望格式 "timestamp,ip"
	parts := strings.SplitN(lastRecord, ",", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid IP record format")
	}

	ipRaw := strings.TrimSpace(parts[1])
	if ipRaw == "" {
		return "", fmt.Errorf("empty ip in record")
	}

	// 验证 IP（对带 zone 的 IPv6，去掉 zone 后验证）
	ipToCheck := ipRaw
	if idx := strings.Index(ipToCheck, "%"); idx >= 0 {
		ipToCheck = ipToCheck[:idx]
	}
	if net.ParseIP(ipToCheck) == nil {
		return "", fmt.Errorf("invalid IP address")
	}

	// 返回原始 ip 字符串（保留 zone 如果有）
	return ipRaw, nil
}
