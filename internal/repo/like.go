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

// syncLikeCount 按实际点赞记录回写计数；文章热度由定时任务重算
func syncLikeCount(tx *gorm.DB, targetType string, targetID uint) error {
	var count int64
	if err := tx.Model(&model.Like{}).Where("target_type = ? AND target_id = ?", targetType, targetID).Count(&count).Error; err != nil {
		return err
	}
	switch targetType {
	case constant.TargetTypePost:
		return tx.Model(&model.Post{}).Where("id = ?", targetID).UpdateColumn("like_count", count).Error
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

// GetLikedUsers 获取点赞用户列表，按点赞时间倒序，只返回最近点赞的 limit 人
func (l *likeRepo) GetLikedUsers(targetID uint, targetType string, limit int) ([]model.User, error) {
	if err := l.checkTargetType(targetType); err != nil {
		return nil, err
	}
	var users []model.User
	var likes []model.Like
	// 先查询所有相关的点赞记录并 preload 关联的 User，并限制数量
	if err := GetDB().Where("target_type = ? AND target_id = ?", targetType, targetID).
		Order("created_at DESC, id DESC").
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

// ListLikesByUser 列出某用户的点赞记录（用户主页使用），只保留目标仍存在且可见的记录，按点赞时间倒序
//   - viewAll：管理员查看，未删除的目标全部可见
//   - isSelf：本人查看，文章、页面需公开或本人所有；
//     私密评论需本人参与过该评论树（含本人发表），或本人是评论所在文章/页面的作者
//   - 其他人查看（用户已公开点赞记录）：只保留公开文章、页面及其下的公开评论
func (l *likeRepo) ListLikesByUser(userID uint, viewAll, isSelf bool, page, size uint64) ([]model.Like, int64, error) {
	// 已删除（软删除）的文章、页面、评论会被模型默认作用域排除
	visibleTargets := func(m any) *gorm.DB {
		sub := GetDB().Model(m).Select("id")
		switch {
		case viewAll:
		case isSelf:
			sub = sub.Where("(is_private = ? OR user_id = ?)", false, userID)
		default:
			sub = sub.Where("is_private = ?", false)
		}
		return sub
	}
	visibleComments := GetDB().Model(&model.Comment{}).Select("id").
		Where("((target_type = ? AND target_id IN (?)) OR (target_type = ? AND target_id IN (?)))",
			constant.TargetTypePost, visibleTargets(&model.Post{}),
			constant.TargetTypePage, visibleTargets(&model.Page{}))
	switch {
	case viewAll:
	case isSelf:
		ownTargets := func(m any) *gorm.DB {
			return GetDB().Model(m).Select("id").Where("user_id = ?", userID)
		}
		participated := GetDB().Model(&model.Comment{}).Select("distinct root_id").Where("user_id = ?", userID)
		visibleComments = visibleComments.Where("(is_private = ? OR root_id IN (?) OR (target_type = ? AND target_id IN (?)) OR (target_type = ? AND target_id IN (?)))",
			false, participated,
			constant.TargetTypePost, ownTargets(&model.Post{}),
			constant.TargetTypePage, ownTargets(&model.Page{}))
	default:
		visibleComments = visibleComments.Where("is_private = ?", false)
	}

	query := GetDB().Model(&model.Like{}).
		Where("user_id = ?", userID).
		Where("((target_type = ? AND target_id IN (?)) OR (target_type = ? AND target_id IN (?)))",
			constant.TargetTypePost, visibleTargets(&model.Post{}),
			constant.TargetTypeComment, visibleComments)
	return PaginateQuery[model.Like](query, page, size, constant.OrderByCreatedAt, true)
}

// ListLikedPosts 批量读取被点赞文章的标题、slug 与作者，返回以 id 为键的映射
func (l *likeRepo) ListLikedPosts(ids []uint) (map[uint]model.Post, error) {
	result := make(map[uint]model.Post, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var posts []model.Post
	if err := GetDB().Select("id, title, slug, user_id").Preload("User").Where("id IN ?", ids).Find(&posts).Error; err != nil {
		return nil, err
	}
	for _, post := range posts {
		result[post.ID] = post
	}
	return result, nil
}

// ListLikedComments 批量读取被点赞评论的内容、所在目标与作者，返回以 id 为键的映射
func (l *likeRepo) ListLikedComments(ids []uint) (map[uint]model.Comment, error) {
	result := make(map[uint]model.Comment, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var comments []model.Comment
	if err := GetDB().Select("id, content, target_type, target_id, user_id").Preload("User").Where("id IN ?", ids).Find(&comments).Error; err != nil {
		return nil, err
	}
	for _, comment := range comments {
		result[comment.ID] = comment
	}
	return result, nil
}

func (l *likeRepo) checkTargetType(targetType string) error {
	switch targetType {
	case constant.TargetTypePost, constant.TargetTypeComment:
		return nil
	default:
		return errors.New("invalid target type")
	}
}
