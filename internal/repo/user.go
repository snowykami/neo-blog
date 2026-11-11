package repo

import (
	"gorm.io/gorm/clause"
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

// GetUsersByIDs 批量读取用户，用于一次补齐评论里被 @ 的人（列表接口避免 N+1 查询）
func (user *userRepo) GetUsersByIDs(ids []uint) ([]model.User, error) {
	if len(ids) == 0 {
		return []model.User{}, nil
	}
	var users []model.User
	if err := GetDB().Select("id, username, nickname, avatar_url, is_ai").
		Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	return users, nil
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

// 用户的增删改都让前端带 users 标签的缓存失效（用户主页，见 cache_tag.go）

func (user *userRepo) CreateUser(userModel *model.User) error {
	if err := GetDB().Create(userModel).Error; err != nil {
		return err
	}
	TouchCacheTags(CacheTagUsers)
	return nil
}

func (user *userRepo) UpdateUser(userModel *model.User) error {
	if err := GetDB().Updates(userModel).Error; err != nil {
		return err
	}
	TouchCacheTags(CacheTagUsers)
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

// SearchUsers 按用户名或昵称搜索可被提及的用户：只返回可用账号，排除自己，完全匹配的排在前面。
// 关键词按字面匹配（转义 LIKE 通配符），登录用户才能调用，见 UserService.SearchUsers
func (user *userRepo) SearchUsers(keyword string, excludeID uint, limit int) ([]model.User, error) {
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	if keyword == "" {
		return []model.User{}, nil
	}
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	like := "%" + likeEscaper.Replace(keyword) + "%"
	query := GetDB().Model(&model.User{}).
		Where("disabled = ?", false).
		Where("(LOWER(username) LIKE ? ESCAPE '\\' OR LOWER(nickname) LIKE ? ESCAPE '\\')", like, like)
	if excludeID != 0 {
		query = query.Where("id <> ?", excludeID)
	}
	var users []model.User
	// 完全匹配用户名 / 昵称的排最前，其余按用户名排序，结果稳定
	if err := query.
		Order(clause.OrderBy{Expression: clause.Expr{
			SQL:  "CASE WHEN LOWER(username) = ? OR LOWER(nickname) = ? THEN 0 ELSE 1 END, username ASC",
			Vars: []any{keyword, keyword},
		}}).
		Limit(limit).Find(&users).Error; err != nil {
		return nil, err
	}
	return users, nil
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

// GetAIWritingHabit 只查询用户的 AI 写作语言习惯
func (user *userRepo) GetAIWritingHabit(userID uint) (string, error) {
	var habit string
	err := GetDB().Model(&model.User{}).Where("id = ?", userID).Select("ai_writing_habit").Scan(&habit).Error
	return habit, err
}

// UpdateUserColumns 按列更新用户，map 形式允许把字段更新为零值（如清空昵称、启用用户）
func (user *userRepo) UpdateUserColumns(userID uint, columns map[string]any) error {
	if err := GetDB().Model(&model.User{}).Where("id = ?", userID).Updates(columns).Error; err != nil {
		return err
	}
	TouchCacheTags(CacheTagUsers)
	return nil
}

// DeleteUser 删除用户：文章、页面、文件（含已软删除的）、修订记录转交给 transferTo，
// 评论（连同其下回复）、点赞、会话、OIDC 绑定、编辑会话、API Token、协作关系一并删除，最后硬删除用户以释放用户名和邮箱
func (user *userRepo) DeleteUser(userID, transferTo uint) error {
	if userID == 0 || transferTo == 0 || userID == transferTo {
		return errs.NewBadRequest("invalid_target")
	}
	// 文章与页面转交给了别人，作者信息随之变化：文章的访客缓存一并作废
	defer func() {
		InvalidatePostCache()
		TouchCacheTags(CacheTagUsers, CacheTagPages)
	}()
	return GetDB().Transaction(func(tx *gorm.DB) error {
		for _, m := range []any{&model.Post{}, &model.Page{}, &model.File{}} {
			if err := tx.Unscoped().Model(m).Where("user_id = ?", userID).UpdateColumn("user_id", transferTo).Error; err != nil {
				return err
			}
		}
		// 修订记录随文章、页面转交，其引用的 Token 随用户删除
		if err := tx.Model(&model.ContentRevision{}).Where("user_id = ?", userID).
			UpdateColumns(map[string]any{"user_id": transferTo, "api_token_id": nil}).Error; err != nil {
			return err
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
		// 软删除的评论仍引用用户，计数同步完成后硬删除该用户的全部评论（含此前已软删除的）
		if err := tx.Unscoped().Where("user_id = ?", userID).Delete(&model.Comment{}).Error; err != nil {
			return err
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

		// 编辑会话引用 Token，需先于 Token 删除
		for _, m := range []any{&model.Session{}, &model.UserOpenID{}, &model.EditSession{}, &model.APIToken{}} {
			if err := tx.Unscoped().Where("user_id = ?", userID).Delete(m).Error; err != nil {
				return err
			}
		}
		if err := tx.Table("post_collaborators").Where("user_id = ?", userID).Delete(nil).Error; err != nil {
			return err
		}
		if err := deleteUserAIData(tx, userID); err != nil {
			return err
		}
		if err := deleteUserNotifications(tx, userID); err != nil {
			return err
		}
		return tx.Unscoped().Delete(&model.User{}, userID).Error
	})
}

// deleteUserNotifications 删除用户相关的互动事件与通知：作为触发者（actor_id 有外键指向用户，不删无法删除用户）、
// 作为收件人，以及这些事件派生的通知（事件删除后不留孤儿行）
func deleteUserNotifications(tx *gorm.DB, userID uint) error {
	events := tx.Unscoped().Model(&model.InteractionEvent{}).Select("id").Where("actor_id = ? OR owner_id = ?", userID, userID)
	if err := tx.Unscoped().Where("user_id = ? OR actor_id = ? OR event_id IN (?)", userID, userID, events).
		Delete(&model.Notification{}).Error; err != nil {
		return err
	}
	return tx.Unscoped().Where("actor_id = ? OR owner_id = ?", userID, userID).Delete(&model.InteractionEvent{}).Error
}

// FillAvatarIfEmpty 仅在用户尚未设置头像时写入头像地址
func (user *userRepo) FillAvatarIfEmpty(userID uint, avatarUrl string) error {
	result := GetDB().Model(&model.User{}).
		Where("id = ? AND (avatar_url = '' OR avatar_url IS NULL)", userID).
		UpdateColumn("avatar_url", avatarUrl)
	// 每次第三方登录都会调用，只有真的写入了头像才让前端缓存失效
	if result.Error == nil && result.RowsAffected > 0 {
		TouchCacheTags(CacheTagUsers)
	}
	return result.Error
}
