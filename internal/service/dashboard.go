package service

import (
	"context"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
)

const (
	dashboardDaysDefault   = 7
	dashboardListLimit     = 5   // 文章列表条数
	dashboardCommentLimit  = 5   // 最新评论条数
	dashboardSourceLimit   = 8   // 来源排行条数
	dashboardCommentLength = 120 // 评论摘要的最大字符数
)

// dashboardRanges 统计区间：最近 days 个自然日（含今天，按服务器时区），上期为紧邻的同长度区间
type dashboardRanges struct {
	days     []repo.TimeRange // 每个自然日，最后一天截止到明天零点
	current  repo.TimeRange   // 本期：首日零点 ~ 现在
	previous repo.TimeRange   // 上期：同样往前推 days 天，截止时刻与现在对齐，保证两期时长一致
}

func newDashboardRanges(now time.Time, days int) dashboardRanges {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	start := today.AddDate(0, 0, -(days - 1))
	r := dashboardRanges{
		days:     make([]repo.TimeRange, days),
		current:  repo.TimeRange{From: start, To: now},
		previous: repo.TimeRange{From: start.AddDate(0, 0, -days), To: now.AddDate(0, 0, -days)},
	}
	for i := range r.days {
		// 用 AddDate 而不是加 24 小时，夏令时切换日也能对齐零点
		r.days[i] = repo.TimeRange{From: start.AddDate(0, 0, i), To: start.AddDate(0, 0, i+1)}
	}
	return r
}

// GetDashboard 后台首页：累计数据、区间趋势与环比、内容状态、热门文章、最新评论与来源排行
func (c *AdminService) GetDashboard(ctx context.Context, req *dto.DashboardReq) (*dto.DashboardDto, *errs.ServiceError) {
	// 包含全站访问与互动数据，仅管理员可查看；路由已限制，这里再兜底
	if !ctxutils.IsAdmin(ctx) {
		return nil, errs.NewForbidden("permission_denied")
	}
	days := req.Days
	if !(days == 7 || days == 30) {
		days = dashboardDaysDefault
	}
	ranges := newDashboardRanges(time.Now(), days)
	result := &dto.DashboardDto{Days: days}
	failed := errs.NewInternalServer("failed_to_get_dashboard_data")

	if err := c.fillDashboardTotals(result); err != nil {
		return nil, failed
	}
	if err := fillDashboardTrend(result, ranges); err != nil {
		return nil, failed
	}

	var err error
	if result.Summary.PendingComments, err = repo.Dashboard.CountPendingComments(ranges.current.From); err != nil {
		return nil, failed
	}
	if result.Content, err = repo.Dashboard.CountContent(); err != nil {
		return nil, failed
	}
	if result.Sources, err = repo.Dashboard.CountVisitSources(ranges.current, dashboardSourceLimit); err != nil {
		return nil, failed
	}
	if result.Posts.Top, err = repo.Dashboard.ListTopVisitedPosts(ranges.current, dashboardListLimit); err != nil {
		return nil, failed
	}
	if result.Posts.Hot, err = repo.Dashboard.ListPosts("posts.heat", dashboardListLimit); err != nil {
		return nil, failed
	}
	if result.Posts.Recent, err = repo.Dashboard.ListPosts("posts.created_at", dashboardListLimit); err != nil {
		return nil, failed
	}
	if result.Posts.Updated, err = repo.Dashboard.ListPosts("posts.updated_at", dashboardListLimit); err != nil {
		return nil, failed
	}
	if result.RecentComments, err = recentDashboardComments(); err != nil {
		return nil, failed
	}
	return result, nil
}

func (c *AdminService) fillDashboardTotals(result *dto.DashboardDto) error {
	db := repo.GetDB()
	if err := db.Model(&model.Post{}).Count(&result.TotalPosts).Error; err != nil {
		return err
	}
	if err := db.Model(&model.User{}).Count(&result.TotalUsers).Error; err != nil {
		return err
	}
	if err := db.Model(&model.Comment{}).Count(&result.TotalComments).Error; err != nil {
		return err
	}
	if err := db.Model(&model.File{}).Count(&result.TotalFiles).Error; err != nil {
		return err
	}
	return db.Model(&model.Post{}).Select("COALESCE(SUM(view_count), 0)").Scan(&result.TotalViews).Error
}

// fillDashboardTrend 每项指标一条查询：前 len(days) 个结果为逐日数据，最后两个为本期与上期合计
// UV 的本期合计按整个区间去重，不等于逐日 UV 之和
func fillDashboardTrend(result *dto.DashboardDto, r dashboardRanges) error {
	all := append(append([]repo.TimeRange{}, r.days...), r.current, r.previous)
	n := len(r.days)
	metrics := []struct {
		count  func([]repo.TimeRange) ([]int64, error)
		target *dto.DashboardMetric
		point  func(p *dto.DashboardTrendPoint) *int64
	}{
		{repo.Dashboard.CountPV, &result.Summary.PV, func(p *dto.DashboardTrendPoint) *int64 { return &p.PV }},
		{repo.Dashboard.CountUV, &result.Summary.UV, func(p *dto.DashboardTrendPoint) *int64 { return &p.UV }},
		{repo.Dashboard.CountComments, &result.Summary.Comments, func(p *dto.DashboardTrendPoint) *int64 { return &p.Comments }},
		{repo.Dashboard.CountLikes, &result.Summary.Likes, func(p *dto.DashboardTrendPoint) *int64 { return &p.Likes }},
		{repo.Dashboard.CountUsers, &result.Summary.NewUsers, nil},
	}
	result.Trend = make([]dto.DashboardTrendPoint, n)
	for i, day := range r.days {
		result.Trend[i].Date = day.From.Format(time.DateOnly)
	}
	for _, m := range metrics {
		counts, err := m.count(all)
		if err != nil {
			return err
		}
		if m.point != nil {
			for i := 0; i < n; i++ {
				*m.point(&result.Trend[i]) = counts[i]
			}
		}
		*m.target = dto.DashboardMetric{Current: counts[n], Previous: counts[n+1]}
	}
	return nil
}

// recentDashboardComments 最新评论，附带所在文章/页面标题与是否待回复
func recentDashboardComments() ([]dto.DashboardCommentDto, error) {
	comments, err := repo.Dashboard.ListRecentComments(dashboardCommentLimit)
	if err != nil {
		return nil, err
	}
	ids := make([]uint, len(comments))
	targetIDs := map[string][]uint{}
	for i, comment := range comments {
		ids[i] = comment.ID
		targetIDs[comment.TargetType] = append(targetIDs[comment.TargetType], comment.TargetID)
	}
	pending, err := repo.Dashboard.FilterPendingComments(ids)
	if err != nil {
		return nil, err
	}
	infos := map[string]map[uint]repo.TargetInfo{}
	for targetType, targetIDs := range targetIDs {
		if infos[targetType], err = repo.Visit.GetTargetInfos(targetType, targetIDs); err != nil {
			return nil, err
		}
	}
	result := make([]dto.DashboardCommentDto, 0, len(comments))
	for _, comment := range comments {
		item := dto.DashboardCommentDto{
			ID:         comment.ID,
			Content:    truncateRunes(comment.Content, dashboardCommentLength),
			Depth:      comment.Depth,
			ReplyCount: int64(comment.CommentCount),
			IsPrivate:  comment.IsPrivate,
			Pending:    pending[comment.ID],
			CreatedAt:  comment.CreatedAt,
		}
		// 评论者已被删除时 User 为零值，不返回
		if comment.User.ID != 0 {
			user := comment.User.ToDto()
			item.User = &user
		}
		if info, ok := infos[comment.TargetType][comment.TargetID]; ok {
			item.Target = &dto.CommentTargetDto{ID: info.ID, Type: comment.TargetType, Title: info.Title, Slug: info.Slug}
		}
		result = append(result, item)
	}
	return result, nil
}
