package repo

import (
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

type dashboardRepo struct{}

var Dashboard = &dashboardRepo{}

// TimeRange 左闭右开的时间区间
type TimeRange struct {
	From time.Time
	To   time.Time
}

// 待回复的根评论：没有任何回复，且评论者不是所在文章/页面的作者
const pendingCommentCond = `comments.depth = 0 AND comments.comment_count = 0
	AND NOT EXISTS (SELECT 1 FROM posts WHERE comments.target_type = ? AND posts.id = comments.target_id AND posts.user_id = comments.user_id)
	AND NOT EXISTS (SELECT 1 FROM pages WHERE comments.target_type = ? AND pages.id = comments.target_id AND pages.user_id = comments.user_id)`

func pendingCommentArgs() []any {
	return []any{constant.TargetTypePost, constant.TargetTypePage}
}

// countInRanges 一条查询统计多个时间区间（按 created_at）内的记录数；distinct 非空时统计该列去重后的数量
// 用 CASE WHEN 在 SQL 内分桶，同时兼容 SQLite 与 PostgreSQL，不依赖各自的日期函数
// distinct 只能传代码中的固定列名，不能来自用户输入
func countInRanges(q *gorm.DB, distinct string, ranges []TimeRange) ([]int64, error) {
	if len(ranges) == 0 {
		return nil, nil
	}
	cols := make([]string, len(ranges))
	args := make([]any, 0, len(ranges)*2)
	from, to := ranges[0].From, ranges[0].To
	for i, r := range ranges {
		if distinct == "" {
			cols[i] = "COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0)"
		} else {
			cols[i] = fmt.Sprintf("COUNT(DISTINCT CASE WHEN created_at >= ? AND created_at < ? THEN %s END)", distinct)
		}
		args = append(args, r.From, r.To)
		if r.From.Before(from) {
			from = r.From
		}
		if r.To.After(to) {
			to = r.To
		}
	}
	// 外层再按整体区间过滤，便于命中 created_at 索引
	row := q.Select(strings.Join(cols, ", "), args...).Where("created_at >= ? AND created_at < ?", from, to).Row()
	counts := make([]int64, len(ranges))
	dest := make([]any, len(ranges))
	for i := range counts {
		dest[i] = &counts[i]
	}
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	return counts, nil
}

// visits 只统计访问，不含点赞、评论等互动记录
func (d *dashboardRepo) visits() *gorm.DB {
	return GetDB().Model(&model.VisitLog{}).Where("action = ?", constant.VisitActionVisit)
}

// CountPV 各区间的访问次数
func (d *dashboardRepo) CountPV(ranges []TimeRange) ([]int64, error) {
	return countInRanges(d.visits(), "", ranges)
}

// CountUV 各区间的独立访客数，开启“请勿追踪”的访问没有访客ID，不计入
func (d *dashboardRepo) CountUV(ranges []TimeRange) ([]int64, error) {
	return countInRanges(d.visits(), "visitor_id", ranges)
}

// CountComments 各区间新增的评论（含回复，不含已删除）
func (d *dashboardRepo) CountComments(ranges []TimeRange) ([]int64, error) {
	return countInRanges(GetDB().Model(&model.Comment{}), "", ranges)
}

// CountLikes 各区间新增的点赞（文章与评论，已取消的不计）
func (d *dashboardRepo) CountLikes(ranges []TimeRange) ([]int64, error) {
	return countInRanges(GetDB().Model(&model.Like{}), "", ranges)
}

// CountUsers 各区间新注册的用户
func (d *dashboardRepo) CountUsers(ranges []TimeRange) ([]int64, error) {
	return countInRanges(GetDB().Model(&model.User{}), "", ranges)
}

// CountPendingComments 指定时间之后发表、仍待回复的根评论数
func (d *dashboardRepo) CountPendingComments(since time.Time) (int64, error) {
	var count int64
	err := GetDB().Model(&model.Comment{}).
		Where("comments.created_at >= ?", since).
		Where(pendingCommentCond, pendingCommentArgs()...).
		Count(&count).Error
	return count, err
}

// FilterPendingComments 从给定评论中筛出待回复的评论ID
func (d *dashboardRepo) FilterPendingComments(ids []uint) (map[uint]bool, error) {
	result := map[uint]bool{}
	if len(ids) == 0 {
		return result, nil
	}
	var pending []uint
	if err := GetDB().Model(&model.Comment{}).Where("comments.id IN ?", ids).
		Where(pendingCommentCond, pendingCommentArgs()...).
		Pluck("comments.id", &pending).Error; err != nil {
		return nil, err
	}
	for _, id := range pending {
		result[id] = true
	}
	return result, nil
}

// ListRecentComments 最新的评论（含回复）及评论者
func (d *dashboardRepo) ListRecentComments(limit int) ([]model.Comment, error) {
	var comments []model.Comment
	err := GetDB().Preload("User").Order("created_at DESC, id DESC").Limit(limit).Find(&comments).Error
	return comments, err
}

// CountVisitSources 区间内的访问来源排行：常见来源按分类汇总，其他网站按域名区分；不统计站内跳转
func (d *dashboardRepo) CountVisitSources(r TimeRange, limit int) ([]dto.VisitSourceCount, error) {
	sources := []dto.VisitSourceCount{}
	err := d.visits().
		Select("source, CASE WHEN source = ? THEN referrer_host ELSE '' END AS host, COUNT(*) AS count", "external").
		Where("created_at >= ? AND created_at < ? AND source <> '' AND source <> ?", r.From, r.To, "internal").
		Group("source, host").Order("count DESC").Limit(limit).
		Scan(&sources).Error
	return sources, err
}

// 首页文章列表只取摘要字段，has_draft 表示草稿内容与已发布正文不同
const dashboardPostColumns = "posts.id, posts.title, posts.slug, posts.is_private, " +
	"(posts.draft_content IS NOT NULL AND posts.draft_content <> '' AND posts.draft_content <> posts.content) AS has_draft, " +
	"posts.view_count, posts.like_count, posts.comment_count, posts.heat, posts.created_at, posts.updated_at"

// ListPosts 按指定字段倒序取前若干篇文章，orderBy 只能传代码中的固定列名
func (d *dashboardRepo) ListPosts(orderBy string, limit int) ([]dto.DashboardPostDto, error) {
	posts := []dto.DashboardPostDto{}
	err := GetDB().Model(&model.Post{}).Select(dashboardPostColumns).
		Order(orderColumn(orderBy, true)).Order("posts.id DESC").Limit(limit).
		Scan(&posts).Error
	return posts, err
}

// ListTopVisitedPosts 区间内访问次数最多的文章，已删除的文章不计入
func (d *dashboardRepo) ListTopVisitedPosts(r TimeRange, limit int) ([]dto.DashboardPostDto, error) {
	posts := []dto.DashboardPostDto{}
	err := d.visits().
		Select(dashboardPostColumns+", COUNT(*) AS period_views").
		Joins("JOIN posts ON posts.id = visit_logs.target_id AND posts.deleted_at IS NULL").
		Where("visit_logs.target_type = ? AND visit_logs.created_at >= ? AND visit_logs.created_at < ?", constant.TargetTypePost, r.From, r.To).
		// 按主键分组即可，PostgreSQL 允许选取与主键函数依赖的其他列
		Group("posts.id").
		Order("period_views DESC").Order("posts.id DESC").Limit(limit).
		Scan(&posts).Error
	return posts, err
}

// CountContent 文章公开/私密/待发布修改数、页面数与 AI 摘要状态
func (d *dashboardRepo) CountContent() (dto.DashboardContentDto, error) {
	var content dto.DashboardContentDto
	summary := "COALESCE(posts.ai_summary, '') <> ''"
	stale := "COALESCE(posts.ai_summary_source_hash, '') <> '' AND COALESCE(posts.content_hash, '') <> '' AND posts.ai_summary_source_hash <> posts.content_hash"
	err := GetDB().Model(&model.Post{}).Select(strings.Join([]string{
		"COUNT(*) AS posts",
		"COALESCE(SUM(CASE WHEN posts.is_private THEN 0 ELSE 1 END), 0) AS public_posts",
		"COALESCE(SUM(CASE WHEN posts.is_private THEN 1 ELSE 0 END), 0) AS private_posts",
		"COALESCE(SUM(CASE WHEN posts.draft_content IS NOT NULL AND posts.draft_content <> '' AND posts.draft_content <> posts.content THEN 1 ELSE 0 END), 0) AS draft_posts",
		fmt.Sprintf("COALESCE(SUM(CASE WHEN %s AND NOT (%s) THEN 1 ELSE 0 END), 0) AS ai_summary_ready", summary, stale),
		fmt.Sprintf("COALESCE(SUM(CASE WHEN %s AND %s THEN 1 ELSE 0 END), 0) AS ai_summary_stale", summary, stale),
		fmt.Sprintf("COALESCE(SUM(CASE WHEN %s THEN 0 ELSE 1 END), 0) AS ai_summary_missing", summary),
	}, ", ")).Scan(&content).Error
	if err != nil {
		return content, err
	}
	err = GetDB().Model(&model.Page{}).Count(&content.Pages).Error
	return content, err
}
