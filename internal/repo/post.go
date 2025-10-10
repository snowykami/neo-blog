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

func (p *postRepo) DeletePost(id uint) error {
	if err := GetDB().Where("id = ?", id).Delete(&model.Post{}).Error; err != nil {
		return err
	}
	return nil
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

	if err := db.Table("post_labels").
		Select("label_id, COUNT(post_id) as cnt").
		Where("label_id IN ?", labelIDs).
		Group("label_id").
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

	// 原子地增加 view_count
	if err := GetDB().Model(&model.Post{}).Where("id = ?", post.ID).
		UpdateColumn("view_count", gorm.Expr("view_count + ?", 1)).Error; err != nil {
		return nil, err
	}

	// 重新加载（包含关联），以获取更新后的 view_count 用于计算 heat
	if err := GetDB().Preload(clause.Associations).First(&post, post.ID).Error; err != nil {
		return nil, err
	}

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
	if err := GetDB().Save(post).Error; err != nil {
		return err
	}
	return nil
}

func (p *postRepo) ListPosts(currentUserID uint, keywords []string, req *dto.ListPostReq) ([]model.Post, int64, error) {
	if !slices.Contains(constant.OrderByEnumPost, req.OrderBy) {
		return nil, 0, errs.NewBadRequest("invalid_request_parameters")
	}

	query := GetDB().Model(&model.Post{}).Preload(clause.Associations)
	if req.UserID > 0 {
		query = query.Where("user_id = ?", req.UserID)
	}

	if currentUserID > 0 {
		query = query.Where("is_private = ? OR (is_private = ? AND user_id = ?)", false, true, currentUserID)
	} else {
		query = query.Where("is_private = ?", false)
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
		query = query.Joins("JOIN post_labels ON post_labels.post_id = posts.id").
			Where("post_labels.label_id = ?", labelModel.ID)
	}

	if len(keywords) > 0 {
		for _, keyword := range keywords {
			if keyword != "" {
				query = query.Where("title LIKE ? OR content LIKE ?",
					"%"+keyword+"%", "%"+keyword+"%")
			}
		}
	}

	if req.NoContent {
		query = query.Omit("content", "draft_content")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, 0, err
	}

	items, _, err := PaginateQuery[model.Post](query, req.Page, req.Size, req.OrderBy, req.Desc)
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
