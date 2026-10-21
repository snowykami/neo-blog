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

// ToggleLike 切换点赞状态。(target_type, target_id, user_id) 有唯一索引，并发重复点赞时以已点赞处理；
// 点赞数每次按实际记录重新统计，不做增减，避免并发导致计数漂移甚至变成负数
func (l *likeRepo) ToggleLike(userID, targetID uint, targetType string) (bool, error) {
	err := l.checkTargetType(targetType)
	if err != nil {
		return false, err
	}
	var finalStatus bool
	err = GetDB().Transaction(func(tx *gorm.DB) error {
		result := tx.Unscoped().Where("target_type = ? AND target_id = ? AND user_id = ?", targetType, targetID, userID).Delete(&model.Like{})
		if result.Error != nil {
			logrus.Error(result.Error)
			return result.Error
		}
		if result.RowsAffected == 0 {
			like := &model.Like{
				TargetType: targetType,
				TargetID:   targetID,
				UserID:     userID,
			}
			if err := tx.Create(like).Error; err != nil && !errors.Is(err, gorm.ErrDuplicatedKey) {
				return err
			}
			finalStatus = true
		}
		return syncLikeCount(tx, targetType, targetID)
	})
	return finalStatus, err
}

// syncLikeCount 按实际点赞记录回写计数，文章同时刷新热度
func syncLikeCount(tx *gorm.DB, targetType string, targetID uint) error {
	var count int64
	if err := tx.Model(&model.Like{}).Where("target_type = ? AND target_id = ?", targetType, targetID).Count(&count).Error; err != nil {
		return err
	}
	switch targetType {
	case constant.TargetTypePost:
		if err := tx.Model(&model.Post{}).Where("id = ?", targetID).UpdateColumn("like_count", count).Error; err != nil {
			return err
		}
		return refreshPostHeat(tx, targetID)
	case constant.TargetTypeComment:
		return tx.Model(&model.Comment{}).Where("id = ?", targetID).UpdateColumn("like_count", count).Error
	}
	return nil
}

// LikedTargetIDs 批量查询用户点赞过的目标
func (l *likeRepo) LikedTargetIDs(userID uint, targetType string, targetIDs []uint) (map[uint]bool, error) {
	liked := make(map[uint]bool, len(targetIDs))
	if len(targetIDs) == 0 {
		return liked, nil
	}
	var ids []uint
	if err := GetDB().Model(&model.Like{}).
		Where("target_type = ? AND user_id = ? AND target_id IN ?", targetType, userID, targetIDs).
		Pluck("target_id", &ids).Error; err != nil {
		return liked, err
	}
	for _, id := range ids {
		liked[id] = true
	}
	return liked, nil
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

// GetLikedUsers 获取点赞用户列表
func (l *likeRepo) GetLikedUsers(targetID uint, targetType string, limit int) ([]model.User, error) {
	if err := l.checkTargetType(targetType); err != nil {
		return nil, err
	}
	var users []model.User
	var likes []model.Like
	// 先查询所有相关的点赞记录并 preload 关联的 User，并限制数量
	if err := GetDB().Where("target_type = ? AND target_id = ?", targetType, targetID).
		Limit(limit).
		Preload("User").
		Find(&likes).Error; err != nil {
		return nil, err
	}
	// 直接按 likes 顺序把 User 添加到列表（不用去重）
	users = make([]model.User, 0, len(likes))
	for _, lk := range likes {
		users = append(users, lk.User)
	}

	return users, nil
}

func (l *likeRepo) checkTargetType(targetType string) error {
	switch targetType {
	case constant.TargetTypePost, constant.TargetTypeComment:
		return nil
	default:
		return errors.New("invalid target type")
	}
}
