package repo

import (
	"errors"
	"net/http"
	"slices"
	"strconv"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

type CommentRepo struct {
}

var Comment = &CommentRepo{}

// 检查设置父评论是否会造成循环引用
// 它通过向上遍历潜在父评论的所有祖先来实现
func (cr *CommentRepo) isCircularReference(tx *gorm.DB, commentID, parentID uint) (bool, error) {
	// 如果没有父评论，则不可能有循环
	if parentID == 0 {
		return false, nil
	}

	currentID := parentID
	for currentID != 0 {
		// 如果在向上追溯的过程中找到了自己的ID，说明存在循环
		if currentID == commentID {
			return true, nil
		}

		var parent model.Comment
		if err := tx.Where("id = ?", currentID).First(&parent).Error; err != nil {
			// 如果祖先链中的某个评论不存在，说明链已经断开，不可能形成循环
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return false, nil
			}
			return false, err
		}
		// 继续向上追溯
		currentID = parent.ReplyID
	}

	// 已经追溯到树的根节点，没有发现循环
	return false, nil
}

// 递归删除子评论的辅助函数
func (cr *CommentRepo) deleteChildren(tx *gorm.DB, parentID uint) error {
	var children []*model.Comment
	// 1. 找到所有直接子评论
	if err := tx.Where("reply_id = ?", parentID).Find(&children).Error; err != nil {
		return err
	}

	// 2. 对每一个子评论，递归删除它的子评论
	for _, child := range children {
		if err := cr.deleteChildren(tx, child.ID); err != nil {
			return err
		}
	}

	// 3. 删除当前层级的子评论
	if err := tx.Where("reply_id = ?", parentID).Delete(&model.Comment{}).Error; err != nil {
		return err
	}

	return nil
}

func (cr *CommentRepo) CreateComment(comment *model.Comment) (uint, error) {
	var commentID uint
	err := GetDB().Transaction(func(tx *gorm.DB) error {
		depth := 0
		if comment.ReplyID != 0 {
			isCircular, err := cr.isCircularReference(tx, comment.ID, comment.ReplyID)
			if err != nil {
				return err
			}
			if isCircular {
				return errs.New(http.StatusBadRequest, "circular reference detected in comment tree", nil)
			}
			var parentComment model.Comment
			if err := tx.Where("id = ?", comment.ReplyID).First(&parentComment).Error; err != nil {
				return err
			}
			parentComment.CommentCount += 1
			if err := tx.Model(&parentComment).UpdateColumn("CommentCount", parentComment.CommentCount).Error; err != nil {
				return err
			}
			depth = parentComment.Depth + 1
		}
		if depth > utils.Env.GetAsInt(constant.EnvKeyMaxReplyDepth, constant.MaxReplyDepthDefault) {
			return errs.New(http.StatusBadRequest, "exceeded maximum reply depth", nil)
		}
		comment.Depth = depth
		if err := tx.Create(comment).Error; err != nil {
			return err
		}
		commentID = comment.ID // 记录主键
		switch comment.TargetType {
		case constant.TargetTypePost:
			var count int64
			if err := tx.Model(&model.Comment{}).
				Where("target_id = ? AND target_type = ?", comment.TargetID, constant.TargetTypePost).
				Count(&count).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.Post{}).Where("id = ?", comment.TargetID).
				UpdateColumn("comment_count", count).Error; err != nil {
				return err
			}
		default:
			return errs.New(http.StatusBadRequest, "unsupported target type: "+comment.TargetType, nil)
		}
		return nil
	})
	return commentID, err
}
func (cr *CommentRepo) UpdateComment(comment *model.Comment) error {
	if comment.ID == 0 {
		return errs.New(http.StatusBadRequest, "invalid comment ID", nil)
	}

	if err := GetDB().Select("IsPrivate", "Content").Updates(comment).Error; err != nil {
		return err
	}

	return nil
}

func (cr *CommentRepo) DeleteComment(commentID string) error {
	if commentID == "" {
		return errs.New(http.StatusBadRequest, "invalid comment ID", nil)
	}

	err := GetDB().Transaction(func(tx *gorm.DB) error {
		var comment model.Comment

		// 1. 查找主评论
		if err := tx.Where("id = ?", commentID).First(&comment).Error; err != nil {
			return err
		}

		// 2. 删除子评论
		if err := cr.deleteChildren(tx, comment.ID); err != nil {
			return err
		}

		// 3. 删除主评论
		if err := tx.Delete(&comment).Error; err != nil {
			return err
		}

		// 4. 更新父评论的回复计数
		if comment.ReplyID != 0 {
			var parent model.Comment
			if err := tx.Where("id = ?", comment.ReplyID).First(&parent).Error; err != nil {
				return err
			}

			parent.CommentCount -= 1

			if err := tx.Save(&parent).Error; err != nil {
				return err
			}
		}

		// 5. 更新目标的评论数量
		switch comment.TargetType {
		case constant.TargetTypePost:
			var count int64
			if err := tx.Model(&model.Comment{}).
				Where("target_id = ? AND target_type = ?", comment.TargetID, constant.TargetTypePost).
				Count(&count).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.Post{}).Where("id = ?", comment.TargetID).
				UpdateColumn("comment_count", count).Error; err != nil {
				return err
			}
		default:
			return errs.New(http.StatusBadRequest, "unsupported target type: "+comment.TargetType, nil)
		}

		return nil
	})

	if err != nil {
		return err
	}

	return nil
}

func (cr *CommentRepo) GetComment(commentID string) (*model.Comment, error) {
	var comment model.Comment
	if err := GetDB().Where("id = ?", commentID).Preload("User").First(&comment).Error; err != nil {
		return nil, err
	}
	return &comment, nil
}

func (cr *CommentRepo) ListComments(currentUserID, targetID, commentID uint, targetType string, page, size uint64, orderBy string, desc bool, depth int) ([]model.Comment, error) {
	if !slices.Contains(constant.OrderByEnumComment, orderBy) {
		return nil, errs.New(http.StatusBadRequest, "invalid order_by parameter", nil)
	}

	var masterID uint

	if targetType == constant.TargetTypePost {
		post, err := Post.GetPostByID(strconv.Itoa(int(targetID)))
		if err != nil {
			return nil, err
		}
		masterID = post.UserID
	}

	query := GetDB().Model(&model.Comment{}).Preload("User")

	if commentID > 0 {
		query = query.Where("reply_id = ?", commentID)
	}

	if currentUserID > 0 {
		query = query.Where("(is_private = ? OR (is_private = ? AND (user_id = ? OR user_id = ?)))", false, true, currentUserID, masterID)
	} else {
		query = query.Where("is_private = ?", false)
	}

	if depth >= 0 {
		query = query.Where("target_id = ? AND target_type = ? AND depth = ?", targetID, targetType, depth)
	} else {
		query = query.Where("target_id = ? AND target_type = ?", targetID, targetType)
	}

	items, _, err := PaginateQuery[model.Comment](query, page, size, orderBy, desc)

	if err != nil {
		return nil, err
	}

	return items, nil
}

func (cr *CommentRepo) CountComments(targetType string, targetID uint) (int64, error) {
	var count int64
	err := GetDB().Model(&model.Comment{}).Where("target_id = ? AND target_type = ?", targetID, targetType).Count(&count).Error
	if err != nil {
		return 0, err
	}
	return count, nil
}
