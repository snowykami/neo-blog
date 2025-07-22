package repo

import (
	"errors"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

type likeRepo struct{}

var Like = &likeRepo{}

// Like 用户点赞，幂等
func (l *likeRepo) Like(userID, targetID uint, targetType string) error {
	err := l.checkTargetType(targetType)
	if err != nil {
		return err
	}
	var existingLike model.Like
	err = GetDB().Where("target_type = ? AND target_id = ? AND user_id = ?", targetType, targetID, userID).First(&existingLike).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	like := &model.Like{
		TargetType: targetType,
		TargetID:   targetID,
		UserID:     userID,
	}

	return GetDB().Create(like).Error
}

// UnLike 取消点赞
func (l *likeRepo) UnLike(userID, targetID uint, targetType string) error {
	err := l.checkTargetType(targetType)
	if err != nil {
		return err
	}
	return GetDB().Where("target_type = ? AND target_id = ? AND user_id = ?",
		targetType, targetID, userID).Delete(&model.Like{}).Error
}

// IsLiked 检查是否点赞
func (l *likeRepo) IsLiked(userID, targetID uint, targetType string) (bool, error) {
	err := l.checkTargetType(targetType)
	if err != nil {
		return false, err
	}
	var like model.Like
	err = GetDB().Where("target_type = ? AND target_id = ? AND user_id = ?", targetType, targetID, userID).First(&like).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Count 点赞计数
func (l *likeRepo) Count(targetID uint, targetType string) (int64, error) {
	err := l.checkTargetType(targetType)
	if err != nil {
		return 0, err
	}
	var count int64
	err = GetDB().Model(&model.Like{}).Where("target_type = ? AND target_id = ?", targetType, targetID).Count(&count).Error
	if err != nil {
		return 0, err
	}
	return count, nil
}

func (l *likeRepo) checkTargetType(targetType string) error {
	switch targetType {
	case constant.TargetTypePost, constant.TargetTypeComment:
		return nil
	default:
		return errors.New("invalid target type")
	}
}
