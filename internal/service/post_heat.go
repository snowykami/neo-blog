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

// eventDecay 单个互动事件对热度的贡献（未缩放）
func eventDecay(weight float64, at, now time.Time) float64 {
	age := now.Sub(at)
	if age < 0 {
		age = 0
	}
	if age > heatWindow {
		return 0
	}
	return weight * math.Exp2(-float64(age)/float64(heatHalfLife))
}

// postHeatScore 单篇文章的热度分（未缩放）
func postHeatScore(viewCount uint64, events []weightedEvent, now time.Time) float64 {
	score := math.Log1p(float64(viewCount))
	for _, e := range events {
		score += eventDecay(e.weight, e.at, now)
	}
	return score
}

// Refresh 流式重算所有文章的热度（不在内存中攒全量访问/点赞明细切片），只写入有变化的文章，返回更新的数量
func (s *PostHeatService) Refresh(now time.Time) (int, error) {
	// 重算热度前先把共享状态中的阅读量增量落库，确保累计浏览量对数项反映最新访问
	FlushPostViewCounts()
	since := now.Add(-heatWindow)
	bases, err := repo.Post.ListPostHeatBases()
	if err != nil {
		return 0, err
	}
	eventScores := make(map[uint]float64, len(bases))
	if err := repo.Post.StreamHeatVisits(since, func(v repo.HeatEvent) {
		eventScores[v.PostID] += eventDecay(heatWeightVisit, v.CreatedAt, now)
	}); err != nil {
		return 0, err
	}
	if err := repo.Post.StreamHeatLikes(since, func(l repo.HeatEvent) {
		eventScores[l.PostID] += eventDecay(heatWeightLike, l.CreatedAt, now)
	}); err != nil {
		return 0, err
	}
	// 同一用户在同一篇文章下只取最近一条评论
	type commenter struct{ postID, userID uint }
	latest := map[commenter]time.Time{}
	if err := repo.Post.StreamHeatComments(since, func(c repo.HeatEvent) {
		key := commenter{c.PostID, c.UserID}
		if c.CreatedAt.After(latest[key]) {
			latest[key] = c.CreatedAt
		}
	}); err != nil {
		return 0, err
	}
	for key, at := range latest {
		eventScores[key.postID] += eventDecay(heatWeightComment, at, now)
	}

	changed := map[uint]uint64{}
	for _, b := range bases {
		score := math.Log1p(float64(b.ViewCount)) + eventScores[b.ID]
		heat := uint64(math.Round(score * heatScale))
		if heat != b.Heat {
			changed[b.ID] = heat
		}
	}
	if err := repo.Post.UpdatePostHeats(changed); err != nil {
		return 0, err
	}
	return len(changed), nil
}
