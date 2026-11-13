package service

import (
	"context"
	"net/http"
	"testing"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func listInteractions(t *testing.T, admin context.Context) []*dto.VisitLogDto {
	t.Helper()
	items, total, svcerr := NewVisitService().ListVisitLogs(admin, &dto.ListVisitLogReq{
		Action:           "interaction",
		PaginationParams: dto.PaginationParams{Page: 1, Size: 50},
	})
	if svcerr != nil || int(total) != len(items) {
		t.Fatalf("list interactions: total=%d err=%v", total, svcerr)
	}
	return items
}

func TestVisitInteractions(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	authorID, _ := ctxutils.GetCurrentUserID(author)
	otherID, _ := ctxutils.GetCurrentUserID(other)
	postID := createPublicPost(t, author, nil)
	likes := NewLikeService()

	mustLike := func(ctx context.Context, targetType string, targetID uint) {
		t.Helper()
		if _, svcerr := likes.ToggleLike(ctx, targetID, targetType, nil); svcerr != nil {
			t.Fatalf("toggle like: %v", svcerr)
		}
	}
	mustComment := func(ctx context.Context, replyID uint) uint {
		t.Helper()
		id, svcerr := createComment(ctx, postID, replyID, false)
		if svcerr != nil {
			t.Fatalf("create comment: %v", svcerr)
		}
		return id
	}

	// 1. 自己对自己的操作不记录：点赞自己的文章、评论自己的文章、回复/点赞自己的评论
	mustLike(author, constant.TargetTypePost, postID)
	authorComment := mustComment(author, 0)
	authorReply := mustComment(author, authorComment)
	mustLike(author, constant.TargetTypeComment, authorReply)
	if items := listInteractions(t, admin); len(items) != 0 {
		t.Fatalf("self interactions should not be recorded, got %d", len(items))
	}

	// 2. 他人点赞文章会记录，取消点赞后撤销
	mustLike(other, constant.TargetTypePost, postID)
	mustLike(other, constant.TargetTypePost, postID)
	if items := listInteractions(t, admin); len(items) != 0 {
		t.Fatalf("unlike should remove interaction, got %d", len(items))
	}
	mustLike(other, constant.TargetTypePost, postID)

	// 3. 他人评论文章、回复与点赞作者的评论；作者回复他人评论
	otherComment := mustComment(other, 0)
	otherReply := mustComment(other, authorComment)
	mustLike(other, constant.TargetTypeComment, authorReply)
	authorReplyToOther := mustComment(author, otherComment)
	// 回复自己的评论仍不记录
	mustComment(other, otherComment)

	items := listInteractions(t, admin)
	if len(items) != 5 {
		t.Fatalf("expected 5 interactions, got %d", len(items))
	}
	// 按时间倒序：作者回复他人 → 点赞评论 → 回复 → 评论文章 → 点赞文章
	replyToOther, likeComment, reply, comment, likePost := items[0], items[1], items[2], items[3], items[4]
	if likePost.Action != constant.VisitActionLike || likePost.TargetType != constant.TargetTypePost ||
		likePost.User.ID != otherID || likePost.TargetUser == nil || likePost.TargetUser.ID != authorID ||
		likePost.Subject == nil || likePost.Subject.ID != postID {
		t.Fatalf("like post: %+v", likePost)
	}
	if comment.Action != constant.VisitActionComment || comment.TargetType != constant.TargetTypePost ||
		comment.Comment == nil || comment.Comment.ID != otherComment || comment.Subject == nil || comment.Subject.Title != "public" {
		t.Fatalf("comment post: %+v", comment)
	}
	if reply.TargetType != constant.TargetTypeComment || reply.TargetComment == nil || reply.TargetComment.ID != authorComment ||
		reply.Comment == nil || reply.Comment.ID != otherReply || reply.Subject == nil || reply.Subject.ID != postID ||
		reply.TargetUser.ID != authorID {
		t.Fatalf("reply: %+v", reply)
	}
	if likeComment.Action != constant.VisitActionLike || likeComment.TargetComment == nil || likeComment.TargetComment.ID != authorReply ||
		likeComment.Subject == nil {
		t.Fatalf("like comment: %+v", likeComment)
	}
	if replyToOther.User.ID != authorID || replyToOther.TargetUser.ID != otherID || replyToOther.Comment.ID != authorReplyToOther {
		t.Fatalf("author reply to other: %+v", replyToOther)
	}

	// 4. 互动不计入访问统计，按行为筛选互不干扰
	stats, _ := NewVisitService().GetStats(admin, nil)
	if stats.TodayPV != 0 {
		t.Fatalf("interactions should not count as page views: %+v", stats)
	}
	if _, total, _ := NewVisitService().ListVisitLogs(admin, &dto.ListVisitLogReq{Action: constant.VisitActionVisit, PaginationParams: dto.PaginationParams{Page: 1, Size: 10}}); total != 0 {
		t.Fatalf("visit filter should exclude interactions, got %d", total)
	}

	// 5. 删除评论时连带清理相关互动：删除他人的评论会移除“评论文章”和“作者回复他人”
	if svcerr := NewCommentService().DeleteComment(admin, otherComment); svcerr != nil {
		t.Fatalf("delete comment: %v", svcerr)
	}
	if items := listInteractions(t, admin); len(items) != 3 {
		t.Fatalf("expected 3 interactions after delete, got %d", len(items))
	}
}

func TestVisitLogsPermission(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	req := &dto.ListVisitLogReq{PaginationParams: dto.PaginationParams{Page: 1, Size: 10}}
	// 访客记录仅管理员可查看：编辑、普通用户与未登录访客都被拒绝
	for name, ctx := range map[string]context.Context{"editor": author, "other": other, "anonymous": context.Background()} {
		if _, _, svcerr := NewVisitService().ListVisitLogs(ctx, req); svcerr == nil || svcerr.Code != http.StatusForbidden {
			t.Fatalf("%s should be forbidden, got %v", name, svcerr)
		}
	}
	if _, _, svcerr := NewVisitService().ListVisitLogs(admin, req); svcerr != nil {
		t.Fatalf("admin list: %v", svcerr)
	}
}

func TestVisitRandomAndPathNames(t *testing.T) {
	author, admin, other, post, _ := setupEditTest(t)
	svc := NewVisitService()
	if err := repo.GetDB().Create(&model.Category{Name: "技术", Slug: "tech"}).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	if err := repo.GetDB().Model(&model.User{}).Where("username = ?", "other").Update("nickname", "小明").Error; err != nil {
		t.Fatalf("update nickname: %v", err)
	}
	report := func(ctx context.Context, req *dto.ReportVisitReq) {
		t.Helper()
		if _, svcerr := svc.Report(ctx, req, "", VisitClient{IP: testIP, UserAgent: testChromeUA, Hosts: []string{"blog.example.com"}}); svcerr != nil {
			t.Fatalf("report %s: %v", req.Path, svcerr)
		}
	}

	// /random 中转页不入库，随后跳转到的文章来源记为“随机”
	report(other, &dto.ReportVisitReq{Path: "/random", Referrer: "https://blog.example.com/"})
	if n := countVisitLogs(t); n != 0 {
		t.Fatalf("/random should not be recorded, got %d", n)
	}
	report(other, &dto.ReportVisitReq{Path: "/p/1", TargetType: constant.TargetTypePost, TargetID: post.ID, Referrer: "https://blog.example.com/random"})
	var randomLog model.VisitLog
	repo.GetDB().Last(&randomLog)
	if randomLog.Source != "random" {
		t.Fatalf("source after /random: %q", randomLog.Source)
	}

	// 常见路由识别并把 slug / 用户名转换为名称，未知路由回退为原路径
	want := map[string][2]string{
		"/":            {"home", ""},
		"/?label=go":   {"label", "go"},
		"/?query=gin":  {"search", "gin"},
		"/c/tech":      {"category", "技术"},
		"/c":           {"categories", ""},
		"/l":           {"labels", ""},
		"/a":           {"archive", ""},
		"/u/other":     {"user", "小明"},
		"/u/ghost":     {"user", "ghost"},
		"/privacy":     {"privacy", ""},
		"/unknown/xyz": {"other", ""},
	}
	for path := range want {
		report(author, &dto.ReportVisitReq{Path: path})
	}
	items, _, svcerr := svc.ListVisitLogs(admin, &dto.ListVisitLogReq{PaginationParams: dto.PaginationParams{Page: 1, Size: 50}})
	if svcerr != nil {
		t.Fatalf("list: %v", svcerr)
	}
	for _, item := range items {
		expected, ok := want[item.Path]
		if !ok {
			continue
		}
		if item.PathKind != expected[0] || item.PathName != expected[1] {
			t.Fatalf("%s: got kind=%q name=%q, want %v", item.Path, item.PathKind, item.PathName, expected)
		}
		delete(want, item.Path)
	}
	if len(want) != 0 {
		t.Fatalf("missing paths: %v", want)
	}
}

func TestVisitIncludeAIFilter(t *testing.T) {
	author, admin, other, _, _ := setupEditTest(t)
	postID := createPublicPost(t, author, nil)
	svc := NewVisitService()
	likes := NewLikeService()

	aiUser := &model.User{Username: "ai_bot", Nickname: "AI 助手", Email: "ai@example.com", Role: constant.RoleUser, IsAI: true}
	if err := repo.GetDB().Create(aiUser).Error; err != nil {
		t.Fatalf("create ai user: %v", err)
	}
	aiCtx := context.WithValue(context.Background(), "user_id", aiUser.ID)
	anonCtx := context.Background()

	// 匿名访客、普通登录用户与 AI 用户各自访问文章，普通用户与 AI 用户点赞/评论
	if _, svcerr := svc.Report(anonCtx, &dto.ReportVisitReq{Path: "/p/anon", TargetType: constant.TargetTypePost, TargetID: postID}, "", VisitClient{IP: "203.0.113.10", UserAgent: testChromeUA}); svcerr != nil {
		t.Fatalf("anon report: %v", svcerr)
	}
	if _, svcerr := svc.Report(other, &dto.ReportVisitReq{Path: "/p/human", TargetType: constant.TargetTypePost, TargetID: postID}, "", VisitClient{IP: "203.0.113.11", UserAgent: testChromeUA}); svcerr != nil {
		t.Fatalf("human report: %v", svcerr)
	}
	if _, svcerr := svc.Report(aiCtx, &dto.ReportVisitReq{Path: "/p/ai", TargetType: constant.TargetTypePost, TargetID: postID}, "", VisitClient{IP: "203.0.113.12", UserAgent: testChromeUA}); svcerr != nil {
		t.Fatalf("ai report: %v", svcerr)
	}
	if _, svcerr := likes.ToggleLike(other, postID, constant.TargetTypePost, nil); svcerr != nil {
		t.Fatalf("human like: %v", svcerr)
	}
	if _, svcerr := likes.ToggleLike(aiCtx, postID, constant.TargetTypePost, nil); svcerr != nil {
		t.Fatalf("ai like: %v", svcerr)
	}
	if _, svcerr := createComment(aiCtx, postID, 0, false); svcerr != nil {
		t.Fatalf("ai comment: %v", svcerr)
	}

	// 默认（IncludeAI 为空）包含 AI 用户：3 次访问 + 3 次互动 = 6 条记录
	_, defaultTotal, svcerr := svc.ListVisitLogs(admin, &dto.ListVisitLogReq{PaginationParams: dto.PaginationParams{Page: 1, Size: 50}})
	if svcerr != nil || defaultTotal != 6 {
		t.Fatalf("default list total=%d err=%v, want 6", defaultTotal, svcerr)
	}
	defaultStats, svcerr := svc.GetStats(admin, nil)
	if svcerr != nil || defaultStats.TodayPV != 3 || defaultStats.TodayUV != 3 || defaultStats.TodayUserVisits != 2 || defaultStats.TotalVisitors != 3 {
		t.Fatalf("default stats: err=%v %+v", svcerr, defaultStats)
	}
	defaultInsights, svcerr := svc.GetInsights(admin, &dto.VisitInsightsReq{Days: 7})
	if svcerr != nil || defaultInsights.PV != 3 || defaultInsights.UV != 3 || len(defaultInsights.Posts) != 1 || defaultInsights.Posts[0].Likes != 2 || defaultInsights.Posts[0].Comments != 1 {
		t.Fatalf("default insights: err=%v %+v", svcerr, defaultInsights)
	}

	// 关闭包含 AI 用户（IncludeAI = false）：保留匿名与普通用户（2 次访问 + 1 次点赞 = 3 条记录）
	excludeAI := false
	items, filteredTotal, svcerr := svc.ListVisitLogs(admin, &dto.ListVisitLogReq{
		IncludeAI:        &excludeAI,
		PaginationParams: dto.PaginationParams{Page: 1, Size: 50},
	})
	if svcerr != nil || filteredTotal != 3 || len(items) != 3 {
		t.Fatalf("filtered list total=%d len=%d err=%v, want 3", filteredTotal, len(items), svcerr)
	}
	for _, item := range items {
		if item.User != nil && item.User.ID == aiUser.ID {
			t.Fatalf("ai user record should be excluded: %+v", item)
		}
	}
	filteredStats, svcerr := svc.GetStats(admin, &dto.VisitStatsReq{IncludeAI: &excludeAI})
	if svcerr != nil || filteredStats.TodayPV != 2 || filteredStats.TodayUV != 2 || filteredStats.TodayUserVisits != 1 || filteredStats.TotalVisitors != 2 {
		t.Fatalf("filtered stats: err=%v %+v", svcerr, filteredStats)
	}
	filteredInsights, svcerr := svc.GetInsights(admin, &dto.VisitInsightsReq{Days: 7, IncludeAI: &excludeAI})
	if svcerr != nil || filteredInsights.PV != 2 || filteredInsights.UV != 2 || len(filteredInsights.Posts) != 1 || filteredInsights.Posts[0].Views != 2 || filteredInsights.Posts[0].Likes != 1 || filteredInsights.Posts[0].Comments != 0 {
		t.Fatalf("filtered insights: err=%v %+v", svcerr, filteredInsights)
	}
}
