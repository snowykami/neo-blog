package repo

import (
	"strings"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

type userRepo struct{}

var User = &userRepo{}

func (user *userRepo) GetUserByUsername(username string) (*model.User, error) {
	if username == "" {
		return nil, errs.NewBadRequest("username_cannot_be_empty")
	}
	var userModel model.User
	if err := GetDB().Where("username = ?", username).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) GetUserByEmail(email string) (*model.User, error) {
	if email == "" {
		return nil, errs.NewBadRequest("email_cannot_be_empty")
	}
	var userModel model.User
	if err := GetDB().Where("email = ?", email).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) GetUserByID(id uint) (*model.User, error) {
	var userModel model.User
	if err := GetDB().Where("id = ?", id).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) GetUserByUsernameOrEmail(usernameOrEmail string) (*model.User, error) {
	if usernameOrEmail == "" {
		return nil, errs.NewBadRequest("username_cannot_be_empty")
	}
	var userModel model.User
	if err := GetDB().Where("username = ? OR email = ?", usernameOrEmail, usernameOrEmail).First(&userModel).Error; err != nil {
		return nil, err
	}
	return &userModel, nil
}

func (user *userRepo) CreateUser(userModel *model.User) error {
	if err := GetDB().Create(userModel).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) UpdateUser(userModel *model.User) error {
	if err := GetDB().Updates(userModel).Error; err != nil {
		return err
	}
	return nil
}

func (user *userRepo) CheckUsernameExists(username string) (bool, error) {
	var count int64
	if err := GetDB().Model(&model.User{}).Where("username = ?", username).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (user *userRepo) CheckEmailExists(email string) (bool, error) {
	if email == "" {
		return false, errs.NewBadRequest("email_cannot_be_empty")
	}
	var count int64
	if err := GetDB().Model(&model.User{}).Where("email = ?", email).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (user *userRepo) ListUsers(req *dto.AdminListUsersReq) ([]model.User, uint64, error) {
	if req == nil {
		req = &dto.AdminListUsersReq{}
	}

	var users []model.User
	var total int64

	db := GetDB().Model(&model.User{})

	if keyword := strings.TrimSpace(req.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		db = db.Where("username LIKE ? OR nickname LIKE ? OR email LIKE ?", like, like, like)
	}
	if req.Role != "" {
		db = db.Where("role = ?", req.Role)
	}
	switch req.Status {
	case constant.UserStatusActive:
		db = db.Where("disabled = ?", false)
	case constant.UserStatusDisabled:
		db = db.Where("disabled = ?", true)
	}

	db = db.Order(orderColumn(AllowedOrderBy(req.OrderBy, constant.OrderByEnumUser, constant.OrderByCreatedAt), req.Desc))

	// Get total count before applying Limit/Offset
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Limit & Offset
	limit := int(req.Size)
	if limit <= 0 {
		limit = 10
	}
	offset := int(req.Offset())

	if err := db.Limit(limit).Offset(offset).Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, uint64(total), nil
}

// CountActiveAdmins 统计未被禁用的管理员数量，excludeID 非零时排除该用户
func (user *userRepo) CountActiveAdmins(excludeID uint) (int64, error) {
	var count int64
	db := GetDB().Model(&model.User{}).Where("role = ? AND disabled = ?", constant.RoleAdmin, false)
	if excludeID != 0 {
		db = db.Where("id <> ?", excludeID)
	}
	err := db.Count(&count).Error
	return count, err
}

// CountUserContent 统计用户名下的文章、页面、评论数量
func (user *userRepo) CountUserContent(userID uint) (posts, pages, comments int64, err error) {
	db := GetDB()
	if err = db.Model(&model.Post{}).Where("user_id = ?", userID).Count(&posts).Error; err != nil {
		return
	}
	if err = db.Model(&model.Page{}).Where("user_id = ?", userID).Count(&pages).Error; err != nil {
		return
	}
	err = db.Model(&model.Comment{}).Where("user_id = ?", userID).Count(&comments).Error
	return
}

// UpdateUserColumns 按列更新用户，map 形式允许把字段更新为零值（如清空昵称、启用用户）
func (user *userRepo) UpdateUserColumns(userID uint, columns map[string]any) error {
	return GetDB().Model(&model.User{}).Where("id = ?", userID).Updates(columns).Error
}

// DeleteUser 删除用户：文章、页面、文件（含已软删除的）转交给 transferTo，
// 评论（连同其下回复）、点赞、会话、OIDC 绑定、编辑会话一并删除，最后硬删除用户以释放用户名和邮箱
func (user *userRepo) DeleteUser(userID, transferTo uint) error {
	if userID == 0 || transferTo == 0 || userID == transferTo {
		return errs.NewBadRequest("invalid_target")
	}
	return GetDB().Transaction(func(tx *gorm.DB) error {
		for _, m := range []any{&model.Post{}, &model.Page{}, &model.File{}} {
			if err := tx.Unscoped().Model(m).Where("user_id = ?", userID).UpdateColumn("user_id", transferTo).Error; err != nil {
				return err
			}
		}

		// 逐条删除评论，复用评论删除的级联逻辑并同步计数
		var comments []model.Comment
		if err := tx.Where("user_id = ?", userID).Order("id").Find(&comments).Error; err != nil {
			return err
		}
		targets := map[string]map[uint]struct{}{}
		for _, comment := range comments {
			// 已被前面的级联删除的回复跳过
			var exists int64
			if err := tx.Model(&model.Comment{}).Where("id = ?", comment.ID).Count(&exists).Error; err != nil {
				return err
			}
			if exists == 0 {
				continue
			}
			deletedIDs, err := Comment.deleteChildren(tx, comment.ID)
			if err != nil {
				return err
			}
			if err := tx.Delete(&model.Comment{}, comment.ID).Error; err != nil {
				return err
			}
			if err := deleteCommentLikes(tx, append(deletedIDs, comment.ID)); err != nil {
				return err
			}
			if comment.ReplyID != 0 {
				if err := tx.Model(&model.Comment{}).Where("id = ? AND comment_count > 0", comment.ReplyID).
					UpdateColumn("comment_count", gorm.Expr("comment_count - ?", 1)).Error; err != nil {
					return err
				}
			}
			if targets[comment.TargetType] == nil {
				targets[comment.TargetType] = map[uint]struct{}{}
			}
			targets[comment.TargetType][comment.TargetID] = struct{}{}
		}
		for targetType, ids := range targets {
			for targetID := range ids {
				if err := syncTargetCommentCount(tx, targetType, targetID); err != nil {
					return err
				}
			}
		}

		// 删除点赞后回写被点赞目标的计数
		var likes []model.Like
		if err := tx.Where("user_id = ?", userID).Find(&likes).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Where("user_id = ?", userID).Delete(&model.Like{}).Error; err != nil {
			return err
		}
		for _, like := range likes {
			if err := syncLikeCount(tx, like.TargetType, like.TargetID); err != nil {
				return err
			}
		}

		for _, m := range []any{&model.Session{}, &model.UserOpenID{}, &model.EditSession{}} {
			if err := tx.Unscoped().Where("user_id = ?", userID).Delete(m).Error; err != nil {
				return err
			}
		}
		return tx.Unscoped().Delete(&model.User{}, userID).Error
	})
}

// FillAvatarIfEmpty 仅在用户尚未设置头像时写入头像地址
func (user *userRepo) FillAvatarIfEmpty(userID uint, avatarUrl string) error {
	return GetDB().Model(&model.User{}).
		Where("id = ? AND (avatar_url = '' OR avatar_url IS NULL)", userID).
		UpdateColumn("avatar_url", avatarUrl).Error
}
