package repo

import (
	"slices"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

// HeatEvent 计算文章热度用的一次互动
type HeatEvent struct {
	PostID    uint
	UserID    uint // 评论去重用；匿名访问为 0
	CreatedAt time.Time
}

// PostHeatBase 文章当前的累计浏览量与热度
type PostHeatBase struct {
	ID        uint
	ViewCount uint64
	Heat      uint64
}

// IncreaseViewCount 文章浏览量 +1，由访问上报在记录一次新的有效访问后调用
func (p *postRepo) IncreaseViewCount(postID uint) error {
	return GetDB().Model(&model.Post{}).Where("id = ?", postID).UpdateColumn("view_count", gorm.Expr("view_count + 1")).Error
}

func streamHeatQuery(q *gorm.DB, visit func(HeatEvent)) error {
	rows, err := q.Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	d := GetDB()
	for rows.Next() {
		var ev HeatEvent
		if err := d.ScanRows(rows, &ev); err != nil {
			return err
		}
		visit(ev)
	}
	return rows.Err()
}

// StreamHeatVisits 流式扫描近期的文章访问（不一次性加载整张大切片到内存）
func (p *postRepo) StreamHeatVisits(since time.Time, visit func(HeatEvent)) error {
	q := GetDB().Model(&model.VisitLog{}).
		Select("visit_logs.target_id AS post_id, visit_logs.created_at").
		Joins("JOIN posts ON posts.id = visit_logs.target_id AND posts.deleted_at IS NULL").
		Where("visit_logs.action = ? AND visit_logs.target_type = ? AND visit_logs.created_at >= ?", constant.VisitActionVisit, constant.TargetTypePost, since).
		Where("(visit_logs.trust IS NULL OR visit_logs.trust <> ?)", constant.VisitTrustBot).
		Where("(visit_logs.user_id IS NULL OR visit_logs.user_id <> posts.user_id)")
	return streamHeatQuery(q, visit)
}

// StreamHeatLikes 流式扫描近期对文章的点赞（已取消的不计，排除作者给自己点赞）
func (p *postRepo) StreamHeatLikes(since time.Time, visit func(HeatEvent)) error {
	q := GetDB().Model(&model.Like{}).
		Select("likes.target_id AS post_id, likes.user_id, likes.created_at").
		Joins("JOIN posts ON posts.id = likes.target_id AND posts.deleted_at IS NULL").
		Where("likes.target_type = ? AND likes.created_at >= ? AND likes.user_id <> posts.user_id", constant.TargetTypePost, since)
	return streamHeatQuery(q, visit)
}

// StreamHeatComments 流式扫描近期在文章下的评论（不含已删除，排除作者本人）
func (p *postRepo) StreamHeatComments(since time.Time, visit func(HeatEvent)) error {
	q := GetDB().Model(&model.Comment{}).
		Select("comments.target_id AS post_id, comments.user_id, comments.created_at").
		Joins("JOIN posts ON posts.id = comments.target_id AND posts.deleted_at IS NULL").
		Where("comments.target_type = ? AND comments.created_at >= ? AND comments.user_id <> posts.user_id", constant.TargetTypePost, since)
	return streamHeatQuery(q, visit)
}

// ListPostHeatBases 所有文章的累计浏览量与当前热度
func (p *postRepo) ListPostHeatBases() ([]PostHeatBase, error) {
	bases := []PostHeatBase{}
	err := GetDB().Model(&model.Post{}).Select("id, view_count, heat").Scan(&bases).Error
	return bases, err
}

// UpdatePostHeats 按批次使用单条 CASE WHEN 语句更新热度（不更新 updated_at），避免长事务与逐行往返
func (p *postRepo) UpdatePostHeats(heats map[uint]uint64) error {
	if len(heats) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(heats))
	for id := range heats {
		ids = append(ids, id)
	}
	slices.Sort(ids)

	const batchSize = 200
	for start := 0; start < len(ids); start += batchSize {
		chunk := ids[start:min(start+batchSize, len(ids))]
		var caseBuilder strings.Builder
		caseBuilder.WriteString("CASE id")
		args := make([]any, 0, len(chunk)*2)
		for _, id := range chunk {
			caseBuilder.WriteString(" WHEN ? THEN ?")
			args = append(args, id, heats[id])
		}
		caseBuilder.WriteString(" ELSE heat END")
		if err := GetDB().Model(&model.Post{}).
			Where("id IN ?", chunk).
			UpdateColumn("heat", gorm.Expr(caseBuilder.String(), args...)).Error; err != nil {
			return err
		}
	}
	return nil
}
