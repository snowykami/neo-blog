package service

import (
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestDashboardRanges(t *testing.T) {
	now := time.Date(2026, 10, 22, 15, 30, 0, 0, time.Local)
	r := newDashboardRanges(now, 7)
	if len(r.days) != 7 {
		t.Fatalf("days: %d", len(r.days))
	}
	start := time.Date(2026, 10, 16, 0, 0, 0, 0, time.Local)
	if !r.days[0].From.Equal(start) || !r.days[6].To.Equal(time.Date(2026, 10, 23, 0, 0, 0, 0, time.Local)) {
		t.Fatalf("day bounds: %v ~ %v", r.days[0].From, r.days[6].To)
	}
	// 上期与本期时长一致，且紧邻本期之前
	if r.current.To.Sub(r.current.From) != r.previous.To.Sub(r.previous.From) || !r.previous.From.Equal(start.AddDate(0, 0, -7)) {
		t.Fatalf("previous range: %+v current: %+v", r.previous, r.current)
	}
}

func TestGetDashboard(t *testing.T) {
	author, admin, _, privatePost, _ := setupEditTest(t)
	db := repo.GetDB()
	svc := NewAdminService()

	// 1. 非管理员不可查看
	if _, svcerr := svc.GetDashboard(author, &dto.DashboardReq{}); svcerr == nil || svcerr.Code != 403 {
		t.Fatalf("non-admin should be forbidden, got %v", svcerr)
	}

	// 2. 准备数据：一篇公开且有未发布修改的文章
	draft := "<p>draft</p>"
	publicPost := &model.Post{UserID: privatePost.UserID, PostBase: model.PostBase{Title: "public", Content: "<p>pub</p>", DraftContent: &draft}, ViewCount: 9, Heat: 100}
	if err := db.Create(publicPost).Error; err != nil {
		t.Fatalf("create post: %v", err)
	}
	now := time.Now()
	visitors := []model.Visitor{{VisitorKey: "a"}, {VisitorKey: "b"}}
	if err := db.Create(&visitors).Error; err != nil {
		t.Fatalf("create visitors: %v", err)
	}
	visitorA, visitorB := visitors[0].ID, visitors[1].ID
	logs := []model.VisitLog{
		{VisitorID: &visitorA, Action: constant.VisitActionVisit, TargetType: constant.TargetTypePost, TargetID: publicPost.ID, Path: "/p/2", Source: "google", CreatedAt: now},
		{VisitorID: &visitorA, Action: constant.VisitActionVisit, TargetType: constant.TargetTypePost, TargetID: publicPost.ID, Path: "/p/2", Source: "internal", CreatedAt: now.Add(-time.Second)},
		{VisitorID: &visitorB, Action: constant.VisitActionVisit, TargetType: constant.TargetTypePost, TargetID: privatePost.ID, Path: "/p/1", Source: "direct", CreatedAt: now.AddDate(0, 0, -3)},
		{Action: constant.VisitActionVisit, TargetType: "other", Path: "/", Source: "external", ReferrerHost: "example.com", CreatedAt: now.AddDate(0, 0, -3)},
		// 上期的访问与互动记录：不计入本期
		{VisitorID: &visitorB, Action: constant.VisitActionVisit, TargetType: constant.TargetTypePost, TargetID: publicPost.ID, Path: "/p/2", CreatedAt: now.AddDate(0, 0, -8)},
		{Action: constant.VisitActionLike, TargetType: constant.TargetTypePost, TargetID: publicPost.ID, CreatedAt: now},
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatalf("create visit logs: %v", err)
	}
	var otherUser, authorUser model.User
	db.Where("username = ?", "other").First(&otherUser)
	db.Where("username = ?", "author").First(&authorUser)
	comments := []*model.Comment{
		// 读者的根评论，无回复：待回复
		{UserID: otherUser.ID, TargetType: constant.TargetTypePost, TargetID: publicPost.ID, Content: "hello"},
		// 作者在自己文章下的评论：不算待回复
		{UserID: authorUser.ID, TargetType: constant.TargetTypePost, TargetID: publicPost.ID, Content: "note"},
		// 已有回复的根评论：不算待回复
		{UserID: otherUser.ID, TargetType: constant.TargetTypePost, TargetID: publicPost.ID, Content: "q", CommentCount: 1},
	}
	for _, c := range comments {
		if err := db.Create(c).Error; err != nil {
			t.Fatalf("create comment: %v", err)
		}
	}
	if err := db.Create(&model.Like{TargetType: constant.TargetTypePost, TargetID: publicPost.ID, UserID: otherUser.ID}).Error; err != nil {
		t.Fatalf("create like: %v", err)
	}

	// 3. 未传或非法的天数按 7 天统计
	result, svcerr := svc.GetDashboard(admin, &dto.DashboardReq{Days: 3})
	if svcerr != nil {
		t.Fatalf("get dashboard: %v", svcerr)
	}
	if result.Days != 7 || len(result.Trend) != 7 || result.Trend[6].Date != now.Format(time.DateOnly) {
		t.Fatalf("trend: days=%d len=%d last=%+v", result.Days, len(result.Trend), result.Trend[len(result.Trend)-1])
	}
	if result.TotalPosts != 2 || result.TotalViews != 9 {
		t.Fatalf("totals: posts=%d views=%d", result.TotalPosts, result.TotalViews)
	}

	// 4. 本期与上期：只统计访问，UV 按访客去重
	s := result.Summary
	if s.PV != (dto.DashboardMetric{Current: 4, Previous: 1}) || s.UV != (dto.DashboardMetric{Current: 2, Previous: 1}) {
		t.Fatalf("pv/uv: %+v %+v", s.PV, s.UV)
	}
	if s.Comments.Current != 3 || s.Likes.Current != 1 || s.PendingComments != 1 {
		t.Fatalf("interactions: comments=%+v likes=%+v pending=%d", s.Comments, s.Likes, s.PendingComments)
	}
	if today := result.Trend[6]; today.PV != 2 || today.UV != 1 || today.Comments != 3 || today.Likes != 1 {
		t.Fatalf("today trend: %+v", today)
	}

	// 5. 内容状态：私密与未发布修改；均未生成 AI 摘要
	c := result.Content
	if c.Posts != 2 || c.PublicPosts != 1 || c.PrivatePosts != 1 || c.DraftPosts != 1 || c.AISummaryMissing != 2 {
		t.Fatalf("content: %+v", c)
	}

	// 6. 热门文章按本期访问排序，来源不含站内跳转
	if len(result.Posts.Top) != 2 || result.Posts.Top[0].ID != publicPost.ID || result.Posts.Top[0].PeriodViews != 2 || !result.Posts.Top[0].HasDraft {
		t.Fatalf("top posts: %+v", result.Posts.Top)
	}
	if len(result.Posts.Hot) == 0 || result.Posts.Hot[0].ID != publicPost.ID {
		t.Fatalf("hot posts: %+v", result.Posts.Hot)
	}
	for _, src := range result.Sources {
		if src.Source == "internal" {
			t.Fatalf("sources should exclude internal: %+v", result.Sources)
		}
	}
	if len(result.Sources) != 3 {
		t.Fatalf("sources: %+v", result.Sources)
	}

	// 7. 最新评论附带所在文章，并标记待回复
	if len(result.RecentComments) != 3 {
		t.Fatalf("recent comments: %+v", result.RecentComments)
	}
	pending := 0
	for _, rc := range result.RecentComments {
		if rc.Target == nil || rc.Target.Title != "public" || rc.User == nil {
			t.Fatalf("comment target/user missing: %+v", rc)
		}
		if rc.Pending {
			pending++
			if rc.Content != "hello" {
				t.Fatalf("wrong pending comment: %+v", rc)
			}
		}
	}
	if pending != 1 {
		t.Fatalf("pending comments in list: %d", pending)
	}
}
