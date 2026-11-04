package repo

import (
	"errors"
	"slices"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
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

// 递归删除子评论的辅助函数，返回被删除的评论 ID
func (cr *CommentRepo) deleteChildren(tx *gorm.DB, parentID uint) ([]uint, error) {
	var children []*model.Comment
	// 1. 找到所有直接子评论
	if err := tx.Where("reply_id = ?", parentID).Find(&children).Error; err != nil {
		return nil, err
	}

	// 2. 对每一个子评论，递归删除它的子评论
	deletedIDs := make([]uint, 0, len(children))
	for _, child := range children {
		ids, err := cr.deleteChildren(tx, child.ID)
		if err != nil {
			return nil, err
		}
		deletedIDs = append(deletedIDs, ids...)
		deletedIDs = append(deletedIDs, child.ID)
	}

	// 3. 删除当前层级的子评论
	if err := tx.Where("reply_id = ?", parentID).Delete(&model.Comment{}).Error; err != nil {
		return nil, err
	}

	return deletedIDs, nil
}

// deleteCommentLikes 清理被删除评论上的点赞、AI 译文，以及访客记录中与这些评论相关的互动（点赞、发表、被回复）
func deleteCommentLikes(tx *gorm.DB, commentIDs []uint) error {
	if len(commentIDs) == 0 {
		return nil
	}
	if err := tx.Unscoped().Where("target_type = ? AND target_id IN ?", constant.TargetTypeComment, commentIDs).Delete(&model.Like{}).Error; err != nil {
		return err
	}
	if err := deleteCommentTranslations(tx, commentIDs); err != nil {
		return err
	}
	return tx.Where("action <> ? AND ((target_type = ? AND target_id IN ?) OR comment_id IN ?)",
		constant.VisitActionVisit, constant.TargetTypeComment, commentIDs, commentIDs).Delete(&model.VisitLog{}).Error
}

// deleteTargetComments 删除文章或页面时一并删除其下全部评论及评论点赞
func deleteTargetComments(tx *gorm.DB, targetType string, targetID uint) error {
	var ids []uint
	if err := tx.Model(&model.Comment{}).Where("target_type = ? AND target_id = ?", targetType, targetID).Pluck("id", &ids).Error; err != nil {
		return err
	}
	if err := deleteCommentLikes(tx, ids); err != nil {
		return err
	}
	return tx.Where("target_type = ? AND target_id = ?", targetType, targetID).Delete(&model.Comment{}).Error
}

// syncTargetCommentCount 重新统计目标的评论数；页面没有评论计数字段，无需维护
func syncTargetCommentCount(tx *gorm.DB, targetType string, targetID uint) error {
	if targetType != constant.TargetTypePost {
		return nil
	}
	var count int64
	if err := tx.Model(&model.Comment{}).
		Where("target_id = ? AND target_type = ?", targetID, targetType).
		Count(&count).Error; err != nil {
		return err
	}
	// 文章热度由定时任务重算
	return tx.Model(&model.Post{}).Where("id = ?", targetID).
		UpdateColumn("comment_count", count).Error
}

// CreateComment 创建评论，maxDepth 为允许的最大回复层级
func (cr *CommentRepo) CreateComment(comment *model.Comment, maxDepth int) (uint, error) {
	var commentID uint
	err := GetDB().Transaction(func(tx *gorm.DB) error {
		depth := 0
		if comment.ReplyID != 0 {
			isCircular, err := cr.isCircularReference(tx, comment.ID, comment.ReplyID)
			if err != nil {
				return err
			}
			if isCircular {
				return errs.NewBadRequest("invalid_request_parameters")
			}
			var parentComment model.Comment
			if err := tx.Where("id = ?", comment.ReplyID).First(&parentComment).Error; err != nil {
				return err
			}
			// 回复必须和父评论属于同一个目标
			if parentComment.TargetID != comment.TargetID || parentComment.TargetType != comment.TargetType {
				return errs.NewBadRequest("invalid_request_parameters")
			}
			// 继承 root_id：如果 parentComment.RootID 非空则继承，否则 parent 自己为 root
			if parentComment.RootID != 0 {
				comment.RootID = parentComment.RootID
			} else {
				comment.RootID = parentComment.ID
			}
			// 若父评论是私密，强制把子评论设为私密（私密树内全部为私密）
			if parentComment.IsPrivate {
				comment.IsPrivate = true
			}
			if err := tx.Model(&parentComment).UpdateColumn("comment_count", gorm.Expr("comment_count + ?", 1)).Error; err != nil {
				return err
			}
			depth = parentComment.Depth + 1
		} else {
			// 根评论：暂时把 RootID 设为 0，创建后再更新为自身 ID（回写）
			comment.RootID = 0
		}
		if depth > maxDepth {
			return errs.NewBadRequest("exceeded_maximum_reply_depth")
		}
		comment.Depth = depth
		if err := tx.Create(comment).Error; err != nil {
			return err
		}
		// 如果是根评论，回写 root_id 为自身 ID
		if comment.RootID == 0 {
			if err := tx.Model(comment).UpdateColumn("root_id", comment.ID).Error; err != nil {
				return err
			}
			comment.RootID = comment.ID
		}
		commentID = comment.ID // 记录主键
		// 更新目标的评论数量
		return syncTargetCommentCount(tx, comment.TargetType, comment.TargetID)
	})
	return commentID, err
}

func (cr *CommentRepo) UpdateComment(comment *model.Comment) error {
	if comment.ID == 0 {
		return errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}

	return GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Select("IsPrivate", "ShowClientInfo", "Content", "Language").Updates(comment).Error; err != nil {
			return err
		}
		// 内容变化后旧译文全部作废
		return deleteStaleCommentTranslations(tx, comment.ID, model.CommentContentMD5(comment.Content))
	})
}

// SetLanguage 记录 AI 识别出的评论语言；评论内容已不是 content（翻译期间被修改）时不更新。
// 用 UpdateColumn 不改 updated_at，评论不会因此显示为「已编辑」
func (cr *CommentRepo) SetLanguage(commentID uint, content, language string) error {
	return GetDB().Model(&model.Comment{}).Where("id = ? AND content = ?", commentID, content).UpdateColumn("language", language).Error
}

func (cr *CommentRepo) DeleteComment(commentID uint) error {
	if commentID == 0 {
		return errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}

	return GetDB().Transaction(func(tx *gorm.DB) error {
		var comment model.Comment

		// 1. 查找主评论
		if err := tx.Where("id = ?", commentID).First(&comment).Error; err != nil {
			return err
		}

		// 2. 删除子评论
		deletedIDs, err := cr.deleteChildren(tx, comment.ID)
		if err != nil {
			return err
		}

		// 3. 删除主评论及整棵子树上的点赞
		if err := tx.Delete(&comment).Error; err != nil {
			return err
		}
		if err := deleteCommentLikes(tx, append(deletedIDs, comment.ID)); err != nil {
			return err
		}

		// 4. 原子地更新父评论的回复计数，不整行覆盖，避免并发时丢失点赞数等字段的更新
		if comment.ReplyID != 0 {
			if err := tx.Model(&model.Comment{}).Where("id = ? AND comment_count > 0", comment.ReplyID).
				UpdateColumn("comment_count", gorm.Expr("comment_count - ?", 1)).Error; err != nil {
				return err
			}
		}

		// 5. 重新计算更新目标的评论数量
		return syncTargetCommentCount(tx, comment.TargetType, comment.TargetID)
	})
}

// HasUserCommentedInTree 用户是否参与过某棵评论树（参与者可以看到树内的私密评论）
func (cr *CommentRepo) HasUserCommentedInTree(rootID, userID uint) (bool, error) {
	if userID == 0 {
		return false, nil
	}
	var count int64
	err := GetDB().Model(&model.Comment{}).Where("root_id = ? AND user_id = ?", rootID, userID).Count(&count).Error
	return count > 0, err
}

func (cr *CommentRepo) GetComment(commentID uint) (*model.Comment, error) {
	var comment model.Comment
	if err := GetDB().Where("id = ?", commentID).Preload("User").First(&comment).Error; err != nil {
		return nil, err
	}
	return &comment, nil
}

// ListComments 列出评论；viewAll 为 true 时（管理员或目标作者）可见全部私密评论
func (cr *CommentRepo) ListComments(currentUserID, targetID, commentID, rootID uint, targetType string, viewAll bool, page, size uint64, orderBy string, desc bool, depth *int) ([]model.Comment, error) {
	if !slices.Contains(constant.OrderByEnumComment, orderBy) {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}

	query := GetDB().Model(&model.Comment{}).Preload("User")

	if commentID > 0 {
		query = query.Where("reply_id = ?", commentID)
	}
	// 主评论下整个回复线程（不含主评论本身）
	if rootID > 0 {
		query = query.Where("root_id = ? AND depth > 0", rootID)
	}
	query = visibleComments(query, currentUserID, viewAll)

	if depth != nil && *depth >= 0 {
		query = query.Where("target_id = ? AND target_type = ? AND depth = ?", targetID, targetType, *depth)
	} else {
		query = query.Where("target_id = ? AND target_type = ?", targetID, targetType)
	}

	items, _, err := PaginateQuery[model.Comment](query, page, size, orderBy, desc)
	if err != nil {
		return nil, err
	}
	return items, nil
}

// ListCommentsAdmin 列出所有评论，包含用户信息，用于后台管理
func (cr *CommentRepo) ListCommentsAdmin(page, size uint64, orderBy string, desc bool, queryText string) ([]model.Comment, int64, error) {
	query := GetDB().Model(&model.Comment{}).Preload("User")
	if queryText != "" {
		like := "%" + queryText + "%"
		query = query.Joins("LEFT JOIN users ON users.id = comments.user_id").
			Where("comments.content LIKE ? OR users.username LIKE ? OR users.nickname LIKE ? OR users.email LIKE ?", like, like, like, like)
	}
	// 搜索时会 JOIN users，排序字段需带上表名避免列名歧义
	orderBy = "comments." + AllowedOrderBy(orderBy, constant.OrderByEnumComment, constant.OrderByCreatedAt)
	items, total, err := PaginateQuery[model.Comment](query, page, size, orderBy, desc)
	return items, total, err
}

// ListCommentsByUser 列出某用户发表的评论（用户主页使用）
//   - viewAll：管理员，可见全部评论
//   - isSelf：本人，可见自己的私密评论，但所属目标仍需为公开或本人所有
//   - 其他访客：只能看到公开文章 / 页面下的公开评论
func (cr *CommentRepo) ListCommentsByUser(userID uint, viewAll, isSelf bool, page, size uint64, orderBy string, desc bool) ([]model.Comment, int64, error) {
	// 已删除（软删除）的目标会被模型默认作用域排除，评论不会指向不存在的文章
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

	query := GetDB().Model(&model.Comment{}).Preload("User").
		Where("user_id = ?", userID).
		Where("((target_type = ? AND target_id IN (?)) OR (target_type = ? AND target_id IN (?)))",
			constant.TargetTypePost, visibleTargets(&model.Post{}),
			constant.TargetTypePage, visibleTargets(&model.Page{}))
	if !(viewAll || isSelf) {
		query = query.Where("is_private = ?", false)
	}
	orderBy = AllowedOrderBy(orderBy, constant.OrderByEnumComment, constant.OrderByCreatedAt)
	return PaginateQuery[model.Comment](query, page, size, orderBy, desc)
}

// CommentTargetBrief 评论目标的标题与链接信息
type CommentTargetBrief struct {
	ID    uint
	Title string
	Slug  *string
}

// ListTargetBriefs 批量读取文章或页面的标题与 slug，返回以 id 为键的映射
func (cr *CommentRepo) ListTargetBriefs(targetType string, ids []uint) (map[uint]CommentTargetBrief, error) {
	result := make(map[uint]CommentTargetBrief, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var m any
	switch targetType {
	case constant.TargetTypePost:
		m = &model.Post{}
	case constant.TargetTypePage:
		m = &model.Page{}
	default:
		return result, nil
	}
	var briefs []CommentTargetBrief
	if err := GetDB().Model(m).Select("id, title, slug").Where("id IN ?", ids).Scan(&briefs).Error; err != nil {
		return nil, err
	}
	for _, b := range briefs {
		result[b.ID] = b
	}
	return result, nil
}

func (cr *CommentRepo) CountComments(targetType string, targetID uint) (int64, error) {
	var count int64
	err := GetDB().Model(&model.Comment{}).Where("target_id = ? AND target_type = ?", targetID, targetType).Count(&count).Error
	if err != nil {
		return 0, err
	}
	return count, nil
}

// visibleComments 评论的可见性规则（基于 root_id）：游客只看公开评论；管理员和目标作者可见全部；
// 普通用户可见公开评论，以及自己参与过的评论树中的私密评论
func visibleComments(query *gorm.DB, currentUserID uint, viewAll bool) *gorm.DB {
	switch {
	case currentUserID == 0:
		return query.Where("is_private = ?", false)
	case viewAll:
		return query
	}
	sub := GetDB().Model(&model.Comment{}).Select("distinct root_id").Where("user_id = ?", currentUserID)
	return query.Where("(is_private = ? OR (is_private = ? AND root_id IN (?)))", false, true, sub)
}

// ThreadSummaries 主评论下整个回复线程（不限层级）中当前用户可见的回复数，以及最早回复的用户（去重，每个线程最多 limit 位）
func (cr *CommentRepo) ThreadSummaries(rootIDs []uint, currentUserID uint, viewAll bool, limit int) (map[uint]int64, map[uint][]model.User, error) {
	counts := map[uint]int64{}
	repliers := map[uint][]model.User{}
	if len(rootIDs) == 0 {
		return counts, repliers, nil
	}
	thread := func() *gorm.DB {
		return visibleComments(GetDB().Model(&model.Comment{}), currentUserID, viewAll).Where("root_id IN ? AND depth > 0", rootIDs)
	}
	var countRows []struct {
		RootID uint
		Count  int64
	}
	if err := thread().Select("root_id, COUNT(*) AS count").Group("root_id").Scan(&countRows).Error; err != nil {
		return nil, nil, err
	}
	for _, row := range countRows {
		counts[row.RootID] = row.Count
	}
	// 每位用户在线程中的第一条回复（id 越小越早），按先后排列
	var userRows []struct {
		RootID  uint
		UserID  uint
		FirstID uint
	}
	if err := thread().Select("root_id, user_id, MIN(id) AS first_id").Group("root_id, user_id").Order("first_id").Scan(&userRows).Error; err != nil {
		return nil, nil, err
	}
	userIDs := make([]uint, 0, len(userRows))
	for _, row := range userRows {
		userIDs = append(userIDs, row.UserID)
	}
	var users []model.User
	if len(userIDs) > 0 {
		if err := GetDB().Where("id IN ?", userIDs).Find(&users).Error; err != nil {
			return nil, nil, err
		}
	}
	byID := make(map[uint]model.User, len(users))
	for _, user := range users {
		byID[user.ID] = user
	}
	for _, row := range userRows {
		if user, ok := byID[row.UserID]; ok && len(repliers[row.RootID]) < limit {
			repliers[row.RootID] = append(repliers[row.RootID], user)
		}
	}
	return counts, repliers, nil
}
