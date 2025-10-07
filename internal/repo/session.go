package repo

import "github.com/snowykami/neo-blog/internal/model"

type sessionRepo struct{}

var Session = sessionRepo{}

func (s *sessionRepo) SaveSession(sessionKey string) error {
	session := &model.Session{
		SessionKey: sessionKey,
	}
	return db.Create(session).Error
}

func (s *sessionRepo) IsSessionValid(sessionKey string) (bool, error) {
	var count int64
	err := db.Model(&model.Session{}).Where("session_key = ?", sessionKey).Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *sessionRepo) RevokeSession(sessionKey string) error {
	return db.Where("session_key = ?", sessionKey).Delete(&model.Session{}).Error
}
