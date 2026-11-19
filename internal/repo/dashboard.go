package repo

import (
	"database/sql"
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

// TrendCounts 单表在趋势各天及本期/上期区间的统计结果
type TrendCounts struct {
	Days     []int64
	Current  int64
	Previous int64
}

// VisitTrendCounts 访问表（PV + UV）在单次扫描中的聚合结果
type VisitTrendCounts struct {
	PV TrendCounts
	UV TrendCounts
}

// PostSummaryTotals 文章总量、总浏览量与内容状态统计（单次扫描 posts 表）
type PostSummaryTotals struct {
	TotalPosts int64
	TotalViews int64
	Content    dto.DashboardContentDto
}

func outerBounds(days []TimeRange, current, previous TimeRange) (time.Time, time.Time) {
	from, to := current.From, current.To
	if previous.From.Before(from) {
		from = previous.From
	}
	if previous.To.After(to) {
		to = previous.To
	}
	for _, r := range days {
		if r.From.Before(from) {
			from = r.From
		}
		if r.To.After(to) {
			to = r.To
		}
	}
	return from, to
}

func matchDayBucket(t time.Time, days []TimeRange) int {
	n := len(days)
	if n == 0 || t.Before(days[0].From) || !t.Before(days[n-1].To) {
		return -1
	}
	idx := int(t.Sub(days[0].From) / (24 * time.Hour))
	if idx < 0 {
		idx = 0
	} else if idx >= n {
		idx = n - 1
	}
	for idx > 0 && t.Before(days[idx].From) {
		idx--
	}
	for idx < n-1 && !t.Before(days[idx].To) {
		idx++
	}
	if !t.Before(days[idx].From) && t.Before(days[idx].To) {
		return idx
	}
	return -1
}

// countTimestampsInRanges 通过索引范围单遍流式扫描 created_at 完成分桶与双期统计，
// 消除 32 路 CASE WHEN 大表达式并同时兼容 SQLite 与 Postgres（沿用 Go 本地日历与夏令时对齐）
func countTimestampsInRanges(q *gorm.DB, days []TimeRange, current, previous TimeRange) (TrendCounts, error) {
	res := TrendCounts{Days: make([]int64, len(days))}
	from, to := outerBounds(days, current, previous)
	rows, err := q.Select("created_at").Where("created_at >= ? AND created_at < ?", from, to).Rows()
	if err != nil {
		return res, err
	}
	defer rows.Close()

	var ts sql.NullTime
	for rows.Next() {
		if err := rows.Scan(&ts); err != nil {
			return res, err
		}
		if !ts.Valid {
			continue
		}
		t := ts.Time
		if idx := matchDayBucket(t, days); idx >= 0 {
			res.Days[idx]++
		}
		if !t.Before(current.From) && t.Before(current.To) {
			res.Current++
		}
		if !t.Before(previous.From) && t.Before(previous.To) {
			res.Previous++
		}
	}
	return res, rows.Err()
}

// CountVisitTrend 单遍扫描 visit_logs 同时汇总 PV 与去重 UV（消除原先 PV/UV 两次扫表与 32 路 COUNT(DISTINCT CASE WHEN)）
func (d *dashboardRepo) CountVisitTrend(days []TimeRange, current, previous TimeRange) (VisitTrendCounts, error) {
	res := VisitTrendCounts{
		PV: TrendCounts{Days: make([]int64, len(days))},
		UV: TrendCounts{Days: make([]int64, len(days))},
	}
	from, to := outerBounds(days, current, previous)
	rows, err := d.visits().Select("created_at, visitor_id").
		Where("created_at >= ? AND created_at < ?", from, to).Rows()
	if err != nil {
		return res, err
	}
	defer rows.Close()

	dayVisitors := make([]map[uint]struct{}, len(days))
	curVisitors := make(map[uint]struct{})
	prevVisitors := make(map[uint]struct{})

	var ts sql.NullTime
	var vid sql.NullInt64
	for rows.Next() {
		if err := rows.Scan(&ts, &vid); err != nil {
			return res, err
		}
		if !ts.Valid {
			continue
		}
		t := ts.Time
		hasVisitor := vid.Valid && vid.Int64 > 0
		visitorID := uint(vid.Int64)

		if idx := matchDayBucket(t, days); idx >= 0 {
			res.PV.Days[idx]++
			if hasVisitor {
				if dayVisitors[idx] == nil {
					dayVisitors[idx] = make(map[uint]struct{})
				}
				dayVisitors[idx][visitorID] = struct{}{}
			}
		}
		if !t.Before(current.From) && t.Before(current.To) {
			res.PV.Current++
			if hasVisitor {
				curVisitors[visitorID] = struct{}{}
			}
		}
		if !t.Before(previous.From) && t.Before(previous.To) {
			res.PV.Previous++
			if hasVisitor {
				prevVisitors[visitorID] = struct{}{}
			}
		}
	}
	if err := rows.Err(); err != nil {
		return res, err
	}
	for i, set := range dayVisitors {
		res.UV.Days[i] = int64(len(set))
	}
	res.UV.Current = int64(len(curVisitors))
	res.UV.Previous = int64(len(prevVisitors))
	return res, nil
}

// visits 只统计访问，不含点赞、评论等互动记录与疑似自动化
func (d *dashboardRepo) visits() *gorm.DB {
	return HumanVisits(GetDB().Model(&model.VisitLog{}))
}

// CountCommentsTrend 各天及双期新增的评论数（含回复，不含已删除与违规已屏蔽）
func (d *dashboardRepo) CountCommentsTrend(days []TimeRange, current, previous TimeRange) (TrendCounts, error) {
	return countTimestampsInRanges(NonRejectedComments(GetDB().Model(&model.Comment{})), days, current, previous)
}

// CountLikesTrend 各天及双期新增的点赞数（文章与评论，已取消的不计）
func (d *dashboardRepo) CountLikesTrend(days []TimeRange, current, previous TimeRange) (TrendCounts, error) {
	return countTimestampsInRanges(GetDB().Model(&model.Like{}), days, current, previous)
}

// CountUsersTrend 各天及双期新注册用户数
func (d *dashboardRepo) CountUsersTrend(days []TimeRange, current, previous TimeRange) (TrendCounts, error) {
	return countTimestampsInRanges(GetDB().Model(&model.User{}), days, current, previous)
}

// CountPendingComments 指定时间之后发表、仍待回复的根评论数（不含违规已屏蔽评论）
func (d *dashboardRepo) CountPendingComments(since time.Time) (int64, error) {
	var count int64
	err := NonRejectedComments(GetDB().Model(&model.Comment{}), "comments").
		Where("comments.created_at >= ?", since).
		Where(pendingCommentCond, pendingCommentArgs()...).
		Count(&count).Error
	return count, err
}

// FilterPendingComments 从给定评论中筛出待回复的评论ID（不含违规已屏蔽评论）
func (d *dashboardRepo) FilterPendingComments(ids []uint) (map[uint]bool, error) {
	result := map[uint]bool{}
	if len(ids) == 0 {
		return result, nil
	}
	var pending []uint
	if err := NonRejectedComments(GetDB().Model(&model.Comment{}), "comments").Where("comments.id IN ?", ids).
		Where(pendingCommentCond, pendingCommentArgs()...).
		Pluck("comments.id", &pending).Error; err != nil {
		return nil, err
	}
	for _, id := range pending {
		result[id] = true
	}
	return result, nil
}

// ListRecentComments 最新的非违规评论（含回复）及评论者
func (d *dashboardRepo) ListRecentComments(limit int) ([]model.Comment, error) {
	var comments []model.Comment
	err := NonRejectedComments(GetDB().Model(&model.Comment{})).Preload("User").Order("created_at DESC, id DESC").Limit(limit).Find(&comments).Error
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

// 首页文章列表只取摘要字段，has_draft 使用持久化布尔列以避免扫描正文大字段
const dashboardPostColumns = "posts.id, posts.title, posts.slug, (posts.is_private OR posts.is_draft) AS is_private, " +
	"(posts.is_draft OR posts.has_draft) AS has_draft, " +
	"posts.view_count, posts.like_count, posts.comment_count, posts.heat, posts.created_at, posts.updated_at"

// ListPosts 按指定字段倒序取前若干篇文章，orderBy 只能传代码中的固定列名
func (d *dashboardRepo) ListPosts(orderBy string, limit int) ([]dto.DashboardPostDto, error) {
	posts := []dto.DashboardPostDto{}
	err := GetDB().Model(&model.Post{}).Select(dashboardPostColumns).
		Order(orderColumn(orderBy, true)).Order("posts.id DESC").Limit(limit).
		Scan(&posts).Error
	return posts, err
}

// ListTopVisitedPosts 区间内访问次数最多的文章，先按访问日志聚合 Top-N，再回表读取文章元数据（已删除的文章不计入）
func (d *dashboardRepo) ListTopVisitedPosts(r TimeRange, limit int) ([]dto.DashboardPostDto, error) {
	posts := []dto.DashboardPostDto{}
	topSub := d.visits().
		Select("visit_logs.target_id, COUNT(*) AS period_views").
		Joins("JOIN posts ON posts.id = visit_logs.target_id AND posts.deleted_at IS NULL").
		Where("visit_logs.target_type = ? AND visit_logs.created_at >= ? AND visit_logs.created_at < ?", constant.TargetTypePost, r.From, r.To).
		Group("visit_logs.target_id").
		Order("period_views DESC, visit_logs.target_id DESC").
		Limit(limit)

	err := GetDB().Model(&model.Post{}).
		Select(dashboardPostColumns+", top_visits.period_views AS period_views").
		Joins("JOIN (?) AS top_visits ON top_visits.target_id = posts.id", topSub).
		Order("top_visits.period_views DESC, posts.id DESC").
		Scan(&posts).Error
	return posts, err
}

// CountPostSummaryAndContent 单次扫描 posts 表汇总文章总数、总浏览量、公开/私密/草稿与 AI 摘要状态，并统计页面总数
func (d *dashboardRepo) CountPostSummaryAndContent() (PostSummaryTotals, error) {
	var row struct {
		TotalPosts       int64
		TotalViews       int64
		PublicPosts      int64
		PrivatePosts     int64
		DraftPosts       int64
		AISummaryReady   int64
		AISummaryStale   int64
		AISummaryMissing int64
	}
	summary := "COALESCE(posts.ai_summary, '') <> ''"
	stale := "COALESCE(posts.ai_summary_source_hash, '') <> '' AND COALESCE(posts.content_hash, '') <> '' AND posts.ai_summary_source_hash <> posts.content_hash"
	err := GetDB().Model(&model.Post{}).Select(strings.Join([]string{
		"COUNT(*) AS total_posts",
		"COALESCE(SUM(posts.view_count), 0) AS total_views",
		"COALESCE(SUM(CASE WHEN NOT posts.is_private AND NOT posts.is_draft THEN 1 ELSE 0 END), 0) AS public_posts",
		"COALESCE(SUM(CASE WHEN posts.is_private THEN 1 ELSE 0 END), 0) AS private_posts",
		"COALESCE(SUM(CASE WHEN posts.is_draft OR posts.has_draft THEN 1 ELSE 0 END), 0) AS draft_posts",
		fmt.Sprintf("COALESCE(SUM(CASE WHEN %s AND NOT (%s) THEN 1 ELSE 0 END), 0) AS ai_summary_ready", summary, stale),
		fmt.Sprintf("COALESCE(SUM(CASE WHEN %s AND %s THEN 1 ELSE 0 END), 0) AS ai_summary_stale", summary, stale),
		fmt.Sprintf("COALESCE(SUM(CASE WHEN %s THEN 0 ELSE 1 END), 0) AS ai_summary_missing", summary),
	}, ", ")).Scan(&row).Error
	if err != nil {
		return PostSummaryTotals{}, err
	}
	var pages int64
	if err := GetDB().Model(&model.Page{}).Count(&pages).Error; err != nil {
		return PostSummaryTotals{}, err
	}
	return PostSummaryTotals{
		TotalPosts: row.TotalPosts,
		TotalViews: row.TotalViews,
		Content: dto.DashboardContentDto{
			Posts:            row.TotalPosts,
			PublicPosts:      row.PublicPosts,
			PrivatePosts:     row.PrivatePosts,
			DraftPosts:       row.DraftPosts,
			Pages:            pages,
			AISummaryReady:   row.AISummaryReady,
			AISummaryStale:   row.AISummaryStale,
			AISummaryMissing: row.AISummaryMissing,
		},
	}, nil
}
