package repo

import (
	"errors"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

type likeRepo struct{}

var Like = &likeRepo{}

func (l *likeRepo) ToggleLike(userID, targetID uint, targetType string) (bool, error) {
	err := l.checkTargetType(targetType)
	if err != nil {
		return false, err
	}
	var finalStatus bool
	err = GetDB().Transaction(func(tx *gorm.DB) error {
		isLiked, err := l.IsLiked(userID, targetID, targetType)
		if err != nil {
			logrus.Error(err)
			return err
		}
		if isLiked {
			if err :=
				tx.Where("target_type = ? AND target_id = ? AND user_id = ?", targetType, targetID, userID).
					Delete(&model.Like{TargetType: targetType, TargetID: targetID, UserID: userID}).
					Error; err != nil {
				logrus.Error(err)
				return err
			}
			finalStatus = false
		} else {
			like := &model.Like{
				TargetType: targetType,
				TargetID:   targetID,
				UserID:     userID,
			}
			if err := tx.Create(like).Error; err != nil {
				return err
			}
			finalStatus = true
		}
		// 重新计算点赞数量
		var count int64
		if err := tx.Model(&model.Like{}).Where("target_type = ? AND target_id = ?", targetType, targetID).Count(&count).Error; err != nil {
			return err
		}
		// 更新目标的点赞数量
		switch targetType {
		case constant.TargetTypePost:
			if err := tx.Model(&model.Post{}).Where("id = ?", targetID).Update("like_count", count).Error; err != nil {
				return err
			}
		case constant.TargetTypeComment:
			if err := tx.Model(&model.Comment{}).Where("id = ?", targetID).Update("like_count", count).Error; err != nil {
				return err
			}
		default:
			return errors.New("invalid target type")
		}
		return nil
	})
	return finalStatus, err
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
