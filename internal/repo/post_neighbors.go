package repo

import (
	"cmp"
	"errors"
	"slices"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

var postNeighborColumns = []string{
	"posts.id", "posts.slug", "posts.title", "posts.description",
	"posts.excerpt", "posts.cover", "posts.category_id", "posts.created_at",
}

func toPostNeighborItemDto(post *model.Post) dto.PostNeighborItemDto {
	var cat *dto.CategoryDto
	if post.Category != nil {
		cat = post.Category.ToDto()
	}
	return dto.PostNeighborItemDto{
		ID:          post.ID,
		Slug:        post.Slug,
		Title:       post.Title,
		Description: post.Description,
		Excerpt:     post.Excerpt,
		Cover:       post.Cover,
		Category:    cat,
		CreatedAt:   post.CreatedAt,
	}
}

// GetPostNeighbors 查询公开文章的上一篇、下一篇与相关推荐文章。
// 严格遵循保守授权：目标文章及所有返回候选均必须满足 is_private = false AND is_draft = false；否则目标返回 gorm.ErrRecordNotFound。
func (p *postRepo) GetPostNeighbors(id uint, relatedLimit int) (*dto.PostNeighborsResp, error) {
	if relatedLimit <= 0 {
		relatedLimit = 4
	}
	db := GetDB()

	var cur struct {
		ID         uint
		CreatedAt  time.Time
		CategoryID *uint
	}
	if err := visiblePosts(db.Model(&model.Post{}), false).
		Select("posts.id, posts.created_at, posts.category_id").
		Where("posts.id = ?", id).
		Take(&cur).Error; err != nil {
		return nil, err
	}

	resp := &dto.PostNeighborsResp{
		Related: []dto.PostNeighborItemDto{},
	}
	excludeIDs := []uint{cur.ID}

	// Prev：比当前文章更早发布的最近一篇公开文章
	var prevPost model.Post
	prevErr := visiblePosts(db.Model(&model.Post{}), false).
		Select(postNeighborColumns).
		Preload("Category").
		Where("posts.created_at < ? OR (posts.created_at = ? AND posts.id < ?)", cur.CreatedAt, cur.CreatedAt, cur.ID).
		Order("posts.created_at DESC, posts.id DESC").
		Take(&prevPost).Error
	if prevErr == nil {
		item := toPostNeighborItemDto(&prevPost)
		resp.Prev = &item
		excludeIDs = append(excludeIDs, prevPost.ID)
	} else if !errors.Is(prevErr, gorm.ErrRecordNotFound) {
		return nil, prevErr
	}

	// Next：比当前文章更晚发布的最近一篇公开文章
	var nextPost model.Post
	nextErr := visiblePosts(db.Model(&model.Post{}), false).
		Select(postNeighborColumns).
		Preload("Category").
		Where("posts.created_at > ? OR (posts.created_at = ? AND posts.id > ?)", cur.CreatedAt, cur.CreatedAt, cur.ID).
		Order("posts.created_at ASC, posts.id ASC").
		Take(&nextPost).Error
	if nextErr == nil {
		item := toPostNeighborItemDto(&nextPost)
		resp.Next = &item
		excludeIDs = append(excludeIDs, nextPost.ID)
	} else if !errors.Is(nextErr, gorm.ErrRecordNotFound) {
		return nil, nextErr
	}

	// Related：按共享标签（每个 +2）与同分类（+1）加权排序，不足时用最新公开文章补齐
	var labelIDs []uint
	if err := db.Table("post_labels").Where("post_id = ?", cur.ID).Pluck("label_id", &labelIDs).Error; err != nil {
		return nil, err
	}

	scoreMap := make(map[uint]int)
	if len(labelIDs) > 0 {
		var labelMatches []struct {
			PostID uint `gorm:"column:post_id"`
			Cnt    int  `gorm:"column:cnt"`
		}
		if err := db.Table("post_labels").
			Select("post_labels.post_id, COUNT(post_labels.label_id) AS cnt").
			Joins("JOIN posts ON posts.id = post_labels.post_id AND posts.deleted_at IS NULL AND posts.is_private = ? AND posts.is_draft = ?", false, false).
			Where("post_labels.label_id IN ? AND post_labels.post_id NOT IN ?", labelIDs, excludeIDs).
			Group("post_labels.post_id").
			Find(&labelMatches).Error; err != nil {
			return nil, err
		}
		for _, m := range labelMatches {
			scoreMap[m.PostID] += m.Cnt * 2
		}
	}

	if cur.CategoryID != nil && *cur.CategoryID > 0 {
		var catPostIDs []uint
		if err := visiblePosts(db.Model(&model.Post{}), false).
			Where("posts.category_id = ? AND posts.id NOT IN ?", *cur.CategoryID, excludeIDs).
			Pluck("posts.id", &catPostIDs).Error; err != nil {
			return nil, err
		}
		for _, pid := range catPostIDs {
			scoreMap[pid] += 1
		}
	}

	if len(scoreMap) > 0 {
		candidateIDs := make([]uint, 0, len(scoreMap))
		for pid := range scoreMap {
			candidateIDs = append(candidateIDs, pid)
		}
		type rankMeta struct {
			ID        uint
			Heat      uint64
			CreatedAt time.Time
		}
		var metas []rankMeta
		if err := visiblePosts(db.Model(&model.Post{}), false).
			Select("posts.id, posts.heat, posts.created_at").
			Where("posts.id IN ?", candidateIDs).
			Find(&metas).Error; err != nil {
			return nil, err
		}
		slices.SortFunc(metas, func(a, b rankMeta) int {
			if c := cmp.Compare(scoreMap[b.ID], scoreMap[a.ID]); c != 0 {
				return c
			}
			if c := cmp.Compare(b.Heat, a.Heat); c != 0 {
				return c
			}
			if !a.CreatedAt.Equal(b.CreatedAt) {
				if b.CreatedAt.After(a.CreatedAt) {
					return 1
				}
				return -1
			}
			return cmp.Compare(b.ID, a.ID)
		})
		if len(metas) > relatedLimit {
			metas = metas[:relatedLimit]
		}
		pickedIDs := make([]uint, 0, len(metas))
		for _, m := range metas {
			pickedIDs = append(pickedIDs, m.ID)
		}
		if len(pickedIDs) > 0 {
			var scoredPosts []model.Post
			if err := visiblePosts(db.Model(&model.Post{}), false).
				Select(postNeighborColumns).
				Preload("Category").
				Where("posts.id IN ?", pickedIDs).
				Find(&scoredPosts).Error; err != nil {
				return nil, err
			}
			byID := make(map[uint]*model.Post, len(scoredPosts))
			for i := range scoredPosts {
				byID[scoredPosts[i].ID] = &scoredPosts[i]
			}
			for _, pid := range pickedIDs {
				if post, ok := byID[pid]; ok {
					resp.Related = append(resp.Related, toPostNeighborItemDto(post))
					excludeIDs = append(excludeIDs, pid)
				}
			}
		}
	}

	// 不足 relatedLimit 时回退补齐最新公开文章
	if remaining := relatedLimit - len(resp.Related); remaining > 0 {
		var fallbackPosts []model.Post
		if err := visiblePosts(db.Model(&model.Post{}), false).
			Select(postNeighborColumns).
			Preload("Category").
			Where("posts.id NOT IN ?", excludeIDs).
			Order("posts.created_at DESC, posts.id DESC").
			Limit(remaining).
			Find(&fallbackPosts).Error; err != nil {
			return nil, err
		}
		for i := range fallbackPosts {
			resp.Related = append(resp.Related, toPostNeighborItemDto(&fallbackPosts[i]))
		}
	}

	return resp, nil
}
