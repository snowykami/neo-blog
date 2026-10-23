package service

import (
	"math"
	"time"

	"github.com/snowykami/neo-blog/internal/repo"
)

// 文章热度：近期互动按发生时间指数衰减后加权求和，再加上累计浏览量的对数作为长期口碑
//
//	热度 = ln(1 + 累计浏览) + Σ 权重 × 0.5^(距今天数 / 半衰期)
//
// - 只统计 heatWindow 内的互动：访问（访问上报已去重、排除爬虫与管理员）、点赞、评论，均不含作者本人
// - 同一用户在同一篇文章下的多条评论只算一次（取最近一条），避免靠刷评论抬高热度
// - 老文章重新被阅读、点赞时热度会回升；长期无人问津的文章逐渐回落到只剩累计浏览的对数
// - 热度随时间变化，由定时任务定期重算，读取文章时不再写库

const (
	heatWindow        = 90 * 24 * time.Hour
	heatHalfLife      = 14 * 24 * time.Hour
	heatWeightVisit   = 1.0
	heatWeightLike    = 5.0
	heatWeightComment = 8.0
	heatScale         = 10 // 热度以 分数×10 的整数存储，保留一位小数的区分度
)

type PostHeatService struct{}

func NewPostHeatService() *PostHeatService {
	return &PostHeatService{}
}

type weightedEvent struct {
	weight float64
	at     time.Time
}

// postHeatScore 单篇文章的热度分（未缩放）
func postHeatScore(viewCount uint64, events []weightedEvent, now time.Time) float64 {
	score := math.Log1p(float64(viewCount))
	for _, e := range events {
		age := now.Sub(e.at)
		if age < 0 {
			age = 0
		}
		if age > heatWindow {
			continue
		}
		score += e.weight * math.Exp2(-float64(age)/float64(heatHalfLife))
	}
	return score
}

// Refresh 重算所有文章的热度，只写入有变化的文章，返回更新的数量
func (s *PostHeatService) Refresh(now time.Time) (int, error) {
	since := now.Add(-heatWindow)
	visits, err := repo.Post.ListHeatVisits(since)
	if err != nil {
		return 0, err
	}
	likes, err := repo.Post.ListHeatLikes(since)
	if err != nil {
		return 0, err
	}
	comments, err := repo.Post.ListHeatComments(since)
	if err != nil {
		return 0, err
	}
	bases, err := repo.Post.ListPostHeatBases()
	if err != nil {
		return 0, err
	}

	events := map[uint][]weightedEvent{}
	for _, v := range visits {
		events[v.PostID] = append(events[v.PostID], weightedEvent{heatWeightVisit, v.CreatedAt})
	}
	for _, l := range likes {
		events[l.PostID] = append(events[l.PostID], weightedEvent{heatWeightLike, l.CreatedAt})
	}
	// 同一用户在同一篇文章下只取最近一条评论
	type commenter struct{ postID, userID uint }
	latest := map[commenter]time.Time{}
	for _, c := range comments {
		key := commenter{c.PostID, c.UserID}
		if c.CreatedAt.After(latest[key]) {
			latest[key] = c.CreatedAt
		}
	}
	for key, at := range latest {
		events[key.postID] = append(events[key.postID], weightedEvent{heatWeightComment, at})
	}

	changed := map[uint]uint64{}
	for _, b := range bases {
		heat := uint64(math.Round(postHeatScore(b.ViewCount, events[b.ID], now) * heatScale))
		if heat != b.Heat {
			changed[b.ID] = heat
		}
	}
	if err := repo.Post.UpdatePostHeats(changed); err != nil {
		return 0, err
	}
	return len(changed), nil
}
