package repo

import (
	"strings"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
	// 使用行级锁（SELECT ... FOR UPDATE）在事务内更新，避免并发拼接丢失
	if sessionID == "" || ip == "" {
		return nil
	}
	entry := utils.NewIPRecord(ip) // 格式：timestamp,ip;

	return db.Transaction(func(tx *gorm.DB) error {
		var sess model.Session
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("session_id = ?", sessionID).
			First(&sess).Error; err != nil {
			return err
		}
		// 在锁保护下安全拼接并写回
		return tx.Model(&sess).
			UpdateColumn("user_ip", gorm.Expr("COALESCE(user_ip, '') || ?", entry)).Error
	})
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

	// 支持 "timestamp,ip" 格式；只要能取到非空 ip 字符串就返回
	parts := strings.SplitN(lastRecord, ",", 2)
	var ipRaw string
	if len(parts) == 2 {
		ipRaw = strings.TrimSpace(parts[1])
	} else {
		// 若不符合 "time,ip" 格式，直接返回整条记录（简化需求）
		ipRaw = lastRecord
	}

	if ipRaw == "" {
		return "", nil
	}
	return ipRaw, nil
}
