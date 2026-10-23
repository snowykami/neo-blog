package repo

import (
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

// ListHeatVisits 近期的文章访问：访问上报已去重并排除爬虫与管理员，这里再排除作者本人
func (p *postRepo) ListHeatVisits(since time.Time) ([]HeatEvent, error) {
	events := []HeatEvent{}
	err := GetDB().Model(&model.VisitLog{}).
		Select("visit_logs.target_id AS post_id, visit_logs.created_at").
		Joins("JOIN posts ON posts.id = visit_logs.target_id AND posts.deleted_at IS NULL").
		Where("visit_logs.action = ? AND visit_logs.target_type = ? AND visit_logs.created_at >= ?", constant.VisitActionVisit, constant.TargetTypePost, since).
		Where("(visit_logs.user_id IS NULL OR visit_logs.user_id <> posts.user_id)").
		Scan(&events).Error
	return events, err
}

// ListHeatLikes 近期对文章的点赞（已取消的不计），排除作者给自己点赞
func (p *postRepo) ListHeatLikes(since time.Time) ([]HeatEvent, error) {
	events := []HeatEvent{}
	err := GetDB().Model(&model.Like{}).
		Select("likes.target_id AS post_id, likes.user_id, likes.created_at").
		Joins("JOIN posts ON posts.id = likes.target_id AND posts.deleted_at IS NULL").
		Where("likes.target_type = ? AND likes.created_at >= ? AND likes.user_id <> posts.user_id", constant.TargetTypePost, since).
		Scan(&events).Error
	return events, err
}

// ListHeatComments 近期在文章下的评论（含回复，不含已删除），排除作者本人的评论
func (p *postRepo) ListHeatComments(since time.Time) ([]HeatEvent, error) {
	events := []HeatEvent{}
	err := GetDB().Model(&model.Comment{}).
		Select("comments.target_id AS post_id, comments.user_id, comments.created_at").
		Joins("JOIN posts ON posts.id = comments.target_id AND posts.deleted_at IS NULL").
		Where("comments.target_type = ? AND comments.created_at >= ? AND comments.user_id <> posts.user_id", constant.TargetTypePost, since).
		Scan(&events).Error
	return events, err
}

// ListPostHeatBases 所有文章的累计浏览量与当前热度
func (p *postRepo) ListPostHeatBases() ([]PostHeatBase, error) {
	bases := []PostHeatBase{}
	err := GetDB().Model(&model.Post{}).Select("id, view_count, heat").Scan(&bases).Error
	return bases, err
}

// UpdatePostHeats 批量写入热度（不更新 updated_at）
func (p *postRepo) UpdatePostHeats(heats map[uint]uint64) error {
	if len(heats) == 0 {
		return nil
	}
	return GetDB().Transaction(func(tx *gorm.DB) error {
		for id, heat := range heats {
			if err := tx.Model(&model.Post{}).Where("id = ?", id).UpdateColumn("heat", heat).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
