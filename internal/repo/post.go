package repo

import (
	"errors"
	"slices"
	"sort"
	"strconv"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type postRepo struct{}

var Post = &postRepo{}

func (p *postRepo) CreatePost(post *model.Post) error {
	return GetDB().Create(post).Error
}

// DeletePost 软删除文章，同时清理评论、点赞和标签关联，并释放 slug 以便新文章复用
func (p *postRepo) DeletePost(id uint) error {
	return GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Post{}).Where("id = ?", id).UpdateColumn("slug", nil).Error; err != nil {
			return err
		}
		if err := deleteTargetComments(tx, constant.TargetTypePost, id); err != nil {
			return err
		}
		if err := tx.Unscoped().Where("target_type = ? AND target_id = ?", constant.TargetTypePost, id).Delete(&model.Like{}).Error; err != nil {
			return err
		}
		if err := tx.Table("post_labels").Where("post_id = ?", id).Delete(nil).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&model.Post{}).Error
	})
}

// helper: 批量查询 labels 对应的 post 数量（返回 map[labelID]count）
func fetchLabelPostCounts(db *gorm.DB, labelIDs []uint) (map[uint]int64, error) {
	counts := make([]struct {
		LabelID uint  `gorm:"column:label_id"`
		Cnt     int64 `gorm:"column:cnt"`
	}, 0)

	if len(labelIDs) == 0 {
		return map[uint]int64{}, nil
	}

	// 只统计未删除的公开文章
	if err := db.Table("post_labels").
		Select("post_labels.label_id, COUNT(post_labels.post_id) as cnt").
		Joins("JOIN posts ON posts.id = post_labels.post_id AND posts.deleted_at IS NULL AND posts.is_private = ?", false).
		Where("post_labels.label_id IN ?", labelIDs).
		Group("post_labels.label_id").
		Find(&counts).Error; err != nil {
		return nil, err
	}

	m := make(map[uint]int64, len(counts))
	for _, r := range counts {
		m[r.LabelID] = r.Cnt
	}
	// ensure zeros for missing ids
	for _, id := range labelIDs {
		if _, ok := m[id]; !ok {
			m[id] = 0
		}
	}
	return m, nil
}

// 把 labels 按照 global post count 排序（降序）
func sortLabelsByPostCount(db *gorm.DB, labels []model.Label) error {
	if len(labels) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(labels))
	for _, l := range labels {
		ids = append(ids, l.ID)
	}
	countMap, err := fetchLabelPostCounts(db, ids)
	if err != nil {
		return err
	}
	sort.Slice(labels, func(i, j int) bool {
		ci := countMap[labels[i].ID]
		cj := countMap[labels[j].ID]
		if ci == cj {
			// 保持稳定顺序：按 ID 升序作为二次排序（可改）
			return labels[i].ID < labels[j].ID
		}
		return ci > cj
	})
	return nil
}

// PostMeta 文章的权限相关字段
type PostMeta struct {
	ID        uint
	UserID    uint
	IsPrivate bool
}

// GetPostMeta 只读取权限判断需要的字段，供评论、点赞等流程使用，避免加载正文与关联
func (p *postRepo) GetPostMeta(id uint) (*PostMeta, error) {
	var meta PostMeta
	if err := GetDB().Model(&model.Post{}).Select("id, user_id, is_private").Where("id = ?", id).Take(&meta).Error; err != nil {
		return nil, err
	}
	return &meta, nil
}

// GetPostByID 按 id 加载文章（含关联），不增加浏览量，供编辑、删除、评论等内部流程使用
// ListPostsForAISummary 全站 AI 摘要所需的字段（不含已删除文章）
func (p *postRepo) ListPostsForAISummary() ([]model.Post, error) {
	var posts []model.Post
	err := GetDB().Model(&model.Post{}).
		Select("id", "title", "content", "description", "content_hash", "ai_summary", "ai_summary_source_hash").
		Order("id ASC").
		Find(&posts).Error
	return posts, err
}

func (p *postRepo) GetPostByID(id uint) (*model.Post, error) {
	var post model.Post
	if err := GetDB().Preload(clause.Associations).First(&post, id).Error; err != nil {
		return nil, err
	}
	// 与 GetPostBySlugOrID 保持一致：labels 按全局 post 数量排序
	if err := sortLabelsByPostCount(GetDB(), post.Labels); err != nil {
		return nil, err
	}
	return &post, nil
}

func (p *postRepo) GetPostBySlugOrID(slugOrId string) (*model.Post, error) {
	var post model.Post

	// 先按 slug 查找（优先）
	if err := GetDB().Where("slug = ?", slugOrId).Preload(clause.Associations).First(&post).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		// slug 未命中，尝试当作 id
		id, perr := strconv.ParseUint(slugOrId, 10, 64)
		if perr != nil {
			// 既不是存在的 slug，也不是合法 id
			return nil, err
		}
		if err := GetDB().Preload(clause.Associations).First(&post, uint(id)).Error; err != nil {
			return nil, err
		}
	}

	// 如果有 labels，按全局 post 数量排序
	if len(post.Labels) > 0 {
		if err := sortLabelsByPostCount(GetDB(), post.Labels); err != nil {
			// 不致命，记录或返回错误视业务而定；这里选择返回错误以便上层感知
			return nil, err
		}
	}

	// 浏览量由访问上报去重后累加（见 IncreaseViewCount），读取文章不再写库
	return &post, nil
}

// 示例：ListTopPosts 在加载 posts 后，对每个 post 的 labels 进行排序
func (p *postRepo) ListTopPosts(limit int) ([]model.Post, error) {
	var posts []model.Post

	// 这里假设已有查询逻辑填充 posts，并 preload 了 labels
	if err := GetDB().Order("view_count desc").Limit(limit).Preload("Labels").Find(&posts).Error; err != nil {
		return nil, err
	}

	// 收集所有 label ids，批量查询 counts 一次性完成
	allLabelIDsSet := make(map[uint]struct{})
	for _, post := range posts {
		for _, l := range post.Labels {
			allLabelIDsSet[l.ID] = struct{}{}
		}
	}
	allLabelIDs := make([]uint, 0, len(allLabelIDsSet))
	for id := range allLabelIDsSet {
		allLabelIDs = append(allLabelIDs, id)
	}

	// 获取全局 counts
	countMap, err := fetchLabelPostCounts(GetDB(), allLabelIDs)
	if err != nil {
		return nil, err
	}

	// 按 count 为每个 post 的 labels 排序（使用相同逻辑）
	for pi := range posts {
		sort.Slice(posts[pi].Labels, func(i, j int) bool {
			ci := countMap[posts[pi].Labels[i].ID]
			cj := countMap[posts[pi].Labels[j].ID]
			if ci == cj {
				return posts[pi].Labels[i].ID < posts[pi].Labels[j].ID
			}
			return ci > cj
		})
	}

	return posts, nil
}

func (p *postRepo) SavePost(post *model.Post) error {
	if post.ID == 0 {
		return errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	// Save 只会追加多对多关联，不会删除已移除的标签，需要显式 Replace
	return GetDB().Transaction(func(tx *gorm.DB) error {
		// 关联字段不随 Save 写入，否则已加载的 Category 会把清空的 category_id 写回去
		if err := tx.Omit(clause.Associations).Save(post).Error; err != nil {
			return err
		}
		return tx.Model(post).Association("Labels").Replace(post.Labels)
	})
}

// ListPosts 列出文章，includeAllPrivate 为 true 时不过滤他人的私密文章（仅供后台管理使用）
func (p *postRepo) ListPosts(currentUserID uint, includeAllPrivate bool, query []string, req *dto.ListPostReq) ([]model.Post, int64, error) {
	if !slices.Contains(constant.OrderByEnumPost, req.OrderBy) {
		return nil, 0, errs.NewBadRequest("invalid_request_parameters")
	}

	// 列表只需要作者、分类和标签，不加载协作者
	q := GetDB().Model(&model.Post{}).Preload("User").Preload("Category").Preload("Labels")
	if req.UserID > 0 {
		q = q.Where("posts.user_id = ?", req.UserID)
	}

	// 后台管理视图（includeAllPrivate）不做私密过滤
	switch {
	case includeAllPrivate:
	case currentUserID > 0:
		q = q.Where("is_private = ? OR (is_private = ? AND user_id = ?)", false, true, currentUserID)
	default:
		q = q.Where("is_private = ?", false)
	}

	if req.Label != "" {
		var labelModel model.Label
		if err := GetDB().Where("name = ? OR slug = ?", req.Label, req.Label).First(&labelModel).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				// 标签不存在，直接返回空结果
				return []model.Post{}, 0, nil
			}
			return nil, 0, err
		}
		q = q.Joins("JOIN post_labels ON post_labels.post_id = posts.id").
			Where("post_labels.label_id = ?", labelModel.ID)
	}

	if req.Category != "" {
		var categoryModel model.Category
		if err := GetDB().Where("name = ? OR slug = ?", req.Category, req.Category).First(&categoryModel).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return []model.Post{}, 0, nil
			}
			return nil, 0, err
		}
		q = q.Where("category_id = ?", categoryModel.ID)
	}

	if len(query) > 0 {
		for _, q_item := range query {
			if q_item != "" {
				q = q.Where("title LIKE ? OR content LIKE ?",
					"%"+q_item+"%", "%"+q_item+"%")
			}
		}
	}

	var total int64
	if err := q.Count(&total).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, 0, err
	}

	// 列表不读取草稿和完整正文，只截取摘要所需的前 201 个字符（摘要截断为 200 字）
	columns := []string{"posts.id", "posts.created_at", "posts.updated_at", "posts.deleted_at", "posts.user_id",
		"posts.category_id", "posts.cover", "posts.description", "posts.is_private", "posts.slug", "posts.title",
		"posts.type", "posts.top", "posts.like_count", "posts.comment_count", "posts.view_count", "posts.heat",
		"posts.content_hash", "posts.ai_summary", "posts.ai_summary_source_hash", "posts.ai_summary_at"}
	if !req.NoContent {
		columns = append(columns, "substr(posts.content, 1, 201) AS content")
	}
	items, err := paginate[model.Post](q.Select(columns).Order("posts.top DESC"), req.Page, req.Size, "posts."+req.OrderBy, req.Desc)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (p *postRepo) ToggleLikePost(postID uint, userID uint) (bool, error) {
	if postID == 0 || userID == 0 {
		return false, errs.NewBadRequest("id_cannot_be_empty_or_zero")
	}
	liked, err := Like.ToggleLike(userID, postID, constant.TargetTypePost)
	if err != nil {
		return false, err
	}
	return liked, nil
}

// ListPublicContentsWithComponents 公开文章（不含私密与草稿）中带内容组件的正文，用于找出文章引用的网易云歌曲（见 service/music_whitelist.go）
func (p *postRepo) ListPublicContentsWithComponents() ([]string, error) {
	var contents []string
	err := GetDB().Model(&model.Post{}).Where("is_private = ? AND content LIKE ?", false, "%data-component%").Pluck("content", &contents).Error
	return contents, err
}

// ListCategories 全部文章分类，新的在前
func (p *postRepo) ListCategories() ([]model.Category, error) {
	var categories []model.Category
	err := GetDB().Order("id DESC").Find(&categories).Error
	return categories, err
}
