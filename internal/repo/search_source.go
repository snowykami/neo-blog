package repo

import (
	"errors"
	"slices"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

// PublicCommentWithTarget 公开评论及其所属公开宿主（文章或页面）的标题与 slug，供索引构建与聚合检索展示
type PublicCommentWithTarget struct {
	Comment     model.Comment
	TargetTitle string
	TargetSlug  *string
}

// ListPublicPostsAfter 按主键游标分批读取公开文章（含正文、作者、分类与标签），用于全量构建索引
func ListPublicPostsAfter(afterID uint, limit int) ([]model.Post, error) {
	var posts []model.Post
	err := GetDB().Model(&model.Post{}).
		Preload("User").Preload("Category").Preload("Labels").
		Where("is_private = ? AND is_draft = ? AND id > ?", false, false, afterID).
		Order("id ASC").Limit(limit).
		Find(&posts).Error
	return posts, err
}

// GetPublicPostForIndex 读取单篇用于索引的公开文章；已删除、私密或尚未首次发布时返回 (nil, nil)
func GetPublicPostForIndex(postID uint) (*model.Post, error) {
	if postID == 0 {
		return nil, nil
	}
	var post model.Post
	err := GetDB().Model(&model.Post{}).
		Preload("User").Preload("Category").Preload("Labels").
		Where("id = ? AND is_private = ? AND is_draft = ?", postID, false, false).
		First(&post).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &post, nil
}

// ListPublicPostIDsByCategory 列出某分类下的全部公开文章 ID（分类改名或删除后刷新索引）
func ListPublicPostIDsByCategory(categoryID uint) ([]uint, error) {
	var ids []uint
	err := GetDB().Model(&model.Post{}).Where("is_private = ? AND is_draft = ? AND category_id = ?", false, false, categoryID).Pluck("id", &ids).Error
	return ids, err
}

// ListPublicPostIDsByLabel 列出带有某标签的全部公开文章 ID（标签改名或删除前刷新索引）
func ListPublicPostIDsByLabel(labelID uint) ([]uint, error) {
	var ids []uint
	err := GetDB().Model(&model.Post{}).
		Joins("JOIN post_labels ON post_labels.post_id = posts.id").
		Where("posts.is_private = ? AND posts.is_draft = ? AND post_labels.label_id = ?", false, false, labelID).
		Pluck("posts.id", &ids).Error
	return ids, err
}

// ListPublicPostIDsByUser 列出某作者的全部公开文章 ID（作者改昵称后刷新索引）
func ListPublicPostIDsByUser(userID uint) ([]uint, error) {
	var ids []uint
	err := GetDB().Model(&model.Post{}).Where("is_private = ? AND is_draft = ? AND user_id = ?", false, false, userID).Pluck("id", &ids).Error
	return ids, err
}

// ListPublicPostIDs 全部公开文章的 ID 集合（用于周期对账）
func ListPublicPostIDs() ([]uint, error) {
	var ids []uint
	err := GetDB().Model(&model.Post{}).Where("is_private = ? AND is_draft = ?", false, false).Order("id ASC").Pluck("id", &ids).Error
	return ids, err
}

// ListPostsByIDsForList 按指定 ID 批量读取公开文章列表字段（不含正文与草稿）
func ListPostsByIDsForList(ids []uint, noContent bool) ([]model.Post, error) {
	if len(ids) == 0 {
		return []model.Post{}, nil
	}
	columns := slices.Clone(postListColumns)
	if !noContent {
		columns = append(columns, "posts.excerpt")
	}
	var posts []model.Post
	err := visiblePosts(GetDB().Model(&model.Post{}).Select(columns).
		Preload("User").Preload("Category").Preload("Labels").
		Where("posts.id IN ?", ids), false).
		Find(&posts).Error
	return posts, err
}

// ListPublicPagesAfter 按主键游标分批读取公开独立页面
func ListPublicPagesAfter(afterID uint, limit int) ([]model.Page, error) {
	var pages []model.Page
	err := GetDB().Model(&model.Page{}).
		Where("is_private = ? AND id > ?", false, afterID).
		Order("id ASC").Limit(limit).
		Find(&pages).Error
	return pages, err
}

// GetPublicPageForIndex 读取单个公开页面；不存在或私密时返回 (nil, nil)
func GetPublicPageForIndex(pageID uint) (*model.Page, error) {
	if pageID == 0 {
		return nil, nil
	}
	var page model.Page
	err := GetDB().Model(&model.Page{}).
		Where("id = ? AND is_private = ?", pageID, false).
		First(&page).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &page, nil
}

// ListPublicPageIDs 全部公开页面的 ID 集合（用于周期对账）
func ListPublicPageIDs() ([]uint, error) {
	var ids []uint
	err := GetDB().Model(&model.Page{}).Where("is_private = ?", false).Order("id ASC").Pluck("id", &ids).Error
	return ids, err
}

// ListPagesByIDsForList 按 ID 批量读取公开页面
func ListPagesByIDsForList(ids []uint, noContent bool) ([]model.Page, error) {
	if len(ids) == 0 {
		return []model.Page{}, nil
	}
	q := GetDB().Model(&model.Page{}).Preload("User").Where("is_private = ? AND id IN ?", false, ids)
	if noContent {
		q = q.Omit("content", "draft_content")
	}
	var pages []model.Page
	err := q.Find(&pages).Error
	return pages, err
}

// publicCommentsQuery 严格双重公开校验：评论本身公开，且所属宿主（文章或页面）存在、未软删除且公开
func publicCommentsQuery() *gorm.DB {
	publicPostIDs := GetDB().Model(&model.Post{}).Select("id").Where("is_private = ? AND is_draft = ?", false, false)
	publicPageIDs := GetDB().Model(&model.Page{}).Select("id").Where("is_private = ?", false)
	return GetDB().Model(&model.Comment{}).
		Where("comments.is_private = ?", false).
		Where("((comments.target_type = ? AND comments.target_id IN (?)) OR (comments.target_type = ? AND comments.target_id IN (?)))",
			constant.TargetTypePost, publicPostIDs,
			constant.TargetTypePage, publicPageIDs)
}

func attachCommentTargets(comments []model.Comment) ([]PublicCommentWithTarget, error) {
	if len(comments) == 0 {
		return []PublicCommentWithTarget{}, nil
	}
	var postIDs, pageIDs []uint
	for i := range comments {
		switch comments[i].TargetType {
		case constant.TargetTypePost:
			if !slices.Contains(postIDs, comments[i].TargetID) {
				postIDs = append(postIDs, comments[i].TargetID)
			}
		case constant.TargetTypePage:
			if !slices.Contains(pageIDs, comments[i].TargetID) {
				pageIDs = append(pageIDs, comments[i].TargetID)
			}
		}
	}
	type targetMeta struct {
		title string
		slug  *string
	}
	postMap := make(map[uint]targetMeta, len(postIDs))
	if len(postIDs) > 0 {
		var posts []model.Post
		if err := GetDB().Model(&model.Post{}).Select("id", "title", "slug").Where("is_private = ? AND is_draft = ? AND id IN ?", false, false, postIDs).Find(&posts).Error; err != nil {
			return nil, err
		}
		for i := range posts {
			postMap[posts[i].ID] = targetMeta{title: posts[i].Title, slug: posts[i].Slug}
		}
	}
	pageMap := make(map[uint]targetMeta, len(pageIDs))
	if len(pageIDs) > 0 {
		var pages []model.Page
		if err := GetDB().Model(&model.Page{}).Select("id", "title", "slug").Where("is_private = ? AND id IN ?", false, pageIDs).Find(&pages).Error; err != nil {
			return nil, err
		}
		for i := range pages {
			slug := pages[i].Slug
			pageMap[pages[i].ID] = targetMeta{title: pages[i].Title, slug: &slug}
		}
	}
	out := make([]PublicCommentWithTarget, 0, len(comments))
	for i := range comments {
		var meta targetMeta
		var ok bool
		switch comments[i].TargetType {
		case constant.TargetTypePost:
			meta, ok = postMap[comments[i].TargetID]
		case constant.TargetTypePage:
			meta, ok = pageMap[comments[i].TargetID]
		}
		if !ok {
			continue
		}
		out = append(out, PublicCommentWithTarget{
			Comment:     comments[i],
			TargetTitle: meta.title,
			TargetSlug:  meta.slug,
		})
	}
	return out, nil
}

// ListPublicCommentsAfter 按主键游标分批读取公开评论及其所属公开目标
func ListPublicCommentsAfter(afterID uint, limit int) ([]PublicCommentWithTarget, error) {
	var comments []model.Comment
	err := publicCommentsQuery().
		Preload("User").
		Where("comments.id > ?", afterID).
		Order("comments.id ASC").Limit(limit).
		Find(&comments).Error
	if err != nil {
		return nil, err
	}
	return attachCommentTargets(comments)
}

// GetPublicCommentForIndex 读取单条公开评论；若评论私密、已删除或宿主不公开则返回 (nil, nil)
func GetPublicCommentForIndex(commentID uint) (*PublicCommentWithTarget, error) {
	if commentID == 0 {
		return nil, nil
	}
	var comment model.Comment
	err := publicCommentsQuery().Preload("User").Where("comments.id = ?", commentID).First(&comment).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	items, err := attachCommentTargets([]model.Comment{comment})
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return &items[0], nil
}

// ListPublicCommentsByTarget 读取某一公开文章或页面下的全部公开评论（宿主由私密转为公开时回填索引）
func ListPublicCommentsByTarget(targetType string, targetID uint) ([]PublicCommentWithTarget, error) {
	var comments []model.Comment
	err := publicCommentsQuery().
		Preload("User").
		Where("comments.target_type = ? AND comments.target_id = ?", targetType, targetID).
		Order("comments.id ASC").
		Find(&comments).Error
	if err != nil {
		return nil, err
	}
	return attachCommentTargets(comments)
}

// ListPublicCommentIDsByUser 列出某用户发表的全部公开评论 ID（用户改昵称后刷新索引）
func ListPublicCommentIDsByUser(userID uint) ([]uint, error) {
	var ids []uint
	err := publicCommentsQuery().Where("comments.user_id = ?", userID).Pluck("comments.id", &ids).Error
	return ids, err
}

// ListPublicCommentIDs 全部公开评论的 ID 集合（用于周期对账）
func ListPublicCommentIDs() ([]uint, error) {
	var ids []uint
	err := publicCommentsQuery().Order("comments.id ASC").Pluck("comments.id", &ids).Error
	return ids, err
}

// ListPublicCommentsByIDs 按 ID 批量读取公开评论及其宿主信息（用于聚合搜索回表）
func ListPublicCommentsByIDs(ids []uint) ([]PublicCommentWithTarget, error) {
	if len(ids) == 0 {
		return []PublicCommentWithTarget{}, nil
	}
	var comments []model.Comment
	if err := publicCommentsQuery().Preload("User").Where("comments.id IN ?", ids).Find(&comments).Error; err != nil {
		return nil, err
	}
	return attachCommentTargets(comments)
}

// SearchPublicCommentsDB 数据库兜底的公开评论搜索（未开启 Meilisearch 时供全站聚合搜索回退使用）
func SearchPublicCommentsDB(keyword string, limit int) ([]PublicCommentWithTarget, error) {
	if keyword == "" || limit <= 0 {
		return []PublicCommentWithTarget{}, nil
	}
	like := "%" + likeEscaper.Replace(keyword) + "%"
	var comments []model.Comment
	err := publicCommentsQuery().
		Preload("User").
		Joins("LEFT JOIN users ON users.id = comments.user_id AND users.deleted_at IS NULL").
		Where("(comments.content LIKE ? ESCAPE '\\' OR users.username LIKE ? ESCAPE '\\' OR users.nickname LIKE ? ESCAPE '\\')", like, like, like).
		Order("comments.id DESC").
		Limit(limit).
		Find(&comments).Error
	if err != nil {
		return nil, err
	}
	return attachCommentTargets(comments)
}

// ListActiveUsersAfter 按主键游标分批读取未禁用用户（供候选用户索引构建）
func ListActiveUsersAfter(afterID uint, limit int) ([]model.User, error) {
	var users []model.User
	err := GetDB().Model(&model.User{}).
		Where("disabled = ? AND id > ?", false, afterID).
		Order("id ASC").Limit(limit).
		Find(&users).Error
	return users, err
}

// GetActiveUserForIndex 读取单个未禁用用户；已删除或已禁用时返回 (nil, nil)
func GetActiveUserForIndex(userID uint) (*model.User, error) {
	if userID == 0 {
		return nil, nil
	}
	var u model.User
	err := GetDB().Model(&model.User{}).Where("id = ? AND disabled = ?", userID, false).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// UsersWithPublicPosts 返回给定用户 ID 中至少发表过一篇公开文章的用户集合
func UsersWithPublicPosts(userIDs []uint) (map[uint]bool, error) {
	out := make(map[uint]bool, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	var authorIDs []uint
	err := GetDB().Model(&model.Post{}).
		Distinct("user_id").
		Where("is_private = ? AND is_draft = ? AND user_id IN ?", false, false, userIDs).
		Pluck("user_id", &authorIDs).Error
	if err != nil {
		return nil, err
	}
	for _, id := range authorIDs {
		out[id] = true
	}
	return out, nil
}

// ListActiveUserIDs 全部未禁用用户的 ID 集合（用于周期对账）
func ListActiveUserIDs() ([]uint, error) {
	var ids []uint
	err := GetDB().Model(&model.User{}).Where("disabled = ?", false).Order("id ASC").Pluck("id", &ids).Error
	return ids, err
}

// ListActiveUsersByIDs 按 ID 批量读取未禁用用户
func ListActiveUsersByIDs(ids []uint) ([]model.User, error) {
	if len(ids) == 0 {
		return []model.User{}, nil
	}
	var users []model.User
	err := GetDB().Model(&model.User{}).Where("disabled = ? AND id IN ?", false, ids).Find(&users).Error
	return users, err
}

// SearchPublicCreatorsDB 数据库兜底的创作者用户搜索（未登录访客在聚合搜索中只看管理员/编辑或发过公开文章的作者）
func SearchPublicCreatorsDB(keyword string, includeAllActive bool, excludeID uint, limit int) ([]model.User, error) {
	if keyword == "" || limit <= 0 {
		return []model.User{}, nil
	}
	if includeAllActive {
		return User.SearchUsers(keyword, excludeID, limit)
	}
	like := "%" + likeEscaper.Replace(keyword) + "%"
	publicAuthorIDs := GetDB().Model(&model.Post{}).Select("user_id").Where("is_private = ? AND is_draft = ?", false, false)
	q := GetDB().Model(&model.User{}).
		Where("disabled = ?", false).
		Where("(role IN ? OR id IN (?))", []constant.Role{constant.RoleAdmin, constant.RoleEditor}, publicAuthorIDs).
		Where("(LOWER(username) LIKE LOWER(?) ESCAPE '\\' OR LOWER(nickname) LIKE LOWER(?) ESCAPE '\\')", like, like)
	if excludeID != 0 {
		q = q.Where("id <> ?", excludeID)
	}
	var users []model.User
	err := q.Order("id ASC").Limit(limit).Find(&users).Error
	return users, err
}
