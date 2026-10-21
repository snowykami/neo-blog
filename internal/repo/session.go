package repo

import (
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxSessionIPRecords = 20

type sessionRepo struct{}

var Session = sessionRepo{}

func (s *sessionRepo) CreateSession(session *model.Session) error {
	return GetDB().Create(session).Error
}

func (s *sessionRepo) IsSessionValid(sessionID string) (bool, error) {
	if sessionID == "" {
		return false, nil
	}
	var count int64
	err := GetDB().Model(&model.Session{}).Where("session_id = ?", sessionID).Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *sessionRepo) IsSessionValidForUser(sessionID string, userID uint) (bool, error) {
	if sessionID == "" || userID == 0 {
		return false, nil
	}
	var count int64
	err := GetDB().Model(&model.Session{}).
		Where("session_id = ? AND user_id = ?", sessionID, userID).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *sessionRepo) RevokeSession(sessionID string) error {
	// 硬删除，误删大不了重新登录
	return GetDB().Unscoped().Where("session_id = ?", sessionID).Delete(&model.Session{}).Error
}

// RevokeUserSessions 吊销用户的所有会话，exceptSessionID 非空时保留该会话（如改密时保留当前登录）
func (s *sessionRepo) RevokeUserSessions(userID uint, exceptSessionID string) error {
	q := GetDB().Unscoped().Where("user_id = ?", userID)
	if exceptSessionID != "" {
		q = q.Where("session_id <> ?", exceptSessionID)
	}
	return q.Delete(&model.Session{}).Error
}

// TouchSession 刷新会话的最近活跃时间，用于清理长期不活跃的会话
func (s *sessionRepo) TouchSession(sessionID string) error {
	return GetDB().Model(&model.Session{}).Where("session_id = ?", sessionID).Update("updated_at", time.Now()).Error
}

// DeleteSessionsInactiveBefore 删除在指定时间之前就不再活跃的会话
func (s *sessionRepo) DeleteSessionsInactiveBefore(before time.Time) (int64, error) {
	result := GetDB().Unscoped().Where("updated_at < ?", before).Delete(&model.Session{})
	return result.RowsAffected, result.Error
}

// 在UserIP字段添加一条新的IP记录，记录格式为 "ip,timestamp;"
func (s *sessionRepo) AddSessionIPRecord(sessionID string, ip string) error {
	// 使用行级锁（SELECT ... FOR UPDATE）在事务内更新，避免并发拼接丢失
	if sessionID == "" || ip == "" {
		return nil
	}
	entry := utils.NewIPRecord(ip) // 格式：timestamp,ip;

	return GetDB().Transaction(func(tx *gorm.DB) error {
		var sess model.Session
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("session_id = ?", sessionID).
			First(&sess).Error; err != nil {
			return err
		}
		// 在锁保护下安全拼接并写回，只保留最近若干条，避免 IP 频繁切换时字段无限增长
		records := strings.Split(strings.TrimRight(sess.UserIP+entry, ";"), ";")
		if len(records) > maxSessionIPRecords {
			records = records[len(records)-maxSessionIPRecords:]
		}
		return tx.Model(&sess).UpdateColumn("user_ip", strings.Join(records, ";")+";").Error
	})
}

func (s *sessionRepo) GetSessionLastIP(sessionID string) (string, error) {
	var session model.Session
	if err := GetDB().Select("user_ip").Where("session_id = ?", sessionID).First(&session).Error; err != nil {
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

func (s *sessionRepo) GetLatestSessionByUserID(userID uint) (*model.Session, error) {
	var session model.Session
	err := GetDB().Where("user_id = ?", userID).Order("created_at DESC").First(&session).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}
