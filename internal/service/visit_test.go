package service

import (
	"context"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

const (
	testChromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
	testIP       = "222.178.10.1" // 重庆 电信
	testFP       = "0123456789abcdef0123456789abcdef"
)

func countVisitLogs(t *testing.T) int64 {
	t.Helper()
	var n int64
	repo.GetDB().Model(&model.VisitLog{}).Count(&n)
	return n
}

func TestVisitReport(t *testing.T) {
	author, admin, _, post, _ := setupEditTest(t)
	svc := NewVisitService()
	anon := context.Background()
	postReq := func(fp string) *dto.ReportVisitReq {
		return &dto.ReportVisitReq{Path: "/p/1", TargetType: constant.TargetTypePost, TargetID: post.ID, Referrer: "https://google.com/", Fingerprint: fp}
	}

	// 1. 新访客：生成访客ID并记录一条，归属地与设备解析正确
	key, svcerr := svc.Report(anon, postReq(testFP), "", testIP, testChromeUA, false)
	if svcerr != nil || key == "" {
		t.Fatalf("first report: key=%q err=%v", key, svcerr)
	}
	var log model.VisitLog
	repo.GetDB().Last(&log)
	if log.Location != "重庆市 电信" || log.OS != "Windows" || log.Browser != "Chrome" || log.DeviceType != "desktop" || log.VisitorID == nil {
		t.Fatalf("unexpected log: %+v", log)
	}
	if log.Source != "google" || log.ReferrerHost != "google.com" {
		t.Fatalf("referrer source: source=%q host=%q", log.Source, log.ReferrerHost)
	}

	// 2. 同一访客 10 分钟内刷新同一页面不重复记录
	if again, _ := svc.Report(anon, postReq(testFP), key, testIP, testChromeUA, false); again != key || countVisitLogs(t) != 1 {
		t.Fatalf("dedup failed: key=%q logs=%d", again, countVisitLogs(t))
	}

	// 3. Cookie 丢失：同指纹、同网段找回原访客；访问另一页面正常记录
	other := &dto.ReportVisitReq{Path: "/a", Fingerprint: testFP}
	if recovered, _ := svc.Report(anon, other, "", "222.178.10.99", testChromeUA, false); recovered != key {
		t.Fatalf("fingerprint recovery failed: got %q want %q", recovered, key)
	}
	// 不同网段即使指纹相同也视为新访客
	if fresh, _ := svc.Report(anon, other, "", "113.92.157.29", testChromeUA, false); fresh == key || fresh == "" {
		t.Fatalf("different network should create new visitor, got %q", fresh)
	}

	// 4. 登录用户访问会关联到访客；管理员与爬虫不记录
	before := countVisitLogs(t)
	if _, svcerr := svc.Report(author, &dto.ReportVisitReq{Path: "/l"}, key, testIP, testChromeUA, false); svcerr != nil {
		t.Fatalf("user report: %v", svcerr)
	}
	visitor, _ := repo.Visit.GetVisitorByKey(key)
	if visitor.UserID == nil || visitor.VisitCount != 3 {
		t.Fatalf("visitor not linked or count wrong: %+v", visitor)
	}
	svc.Report(admin, &dto.ReportVisitReq{Path: "/admin-visit"}, "", testIP, testChromeUA, false)
	svc.Report(anon, &dto.ReportVisitReq{Path: "/bot"}, "", testIP, "Mozilla/5.0 (compatible; Googlebot/2.1)", false)
	if got := countVisitLogs(t); got != before+1 {
		t.Fatalf("admin/bot should not be recorded: logs %d -> %d", before, got)
	}

	// 5. 请勿追踪：只计数，不种 Cookie、不保存 IP/UA/访客
	if dntKey, _ := svc.Report(anon, &dto.ReportVisitReq{Path: "/dnt", Fingerprint: testFP}, "", testIP, testChromeUA, true); dntKey != "" {
		t.Fatalf("dnt should not return visitor key, got %q", dntKey)
	}
	// 用新变量查询，避免 GORM 带上已有主键作为条件
	var dntLog model.VisitLog
	repo.GetDB().Last(&dntLog)
	if dntLog.Path != "/dnt" || dntLog.VisitorID != nil || dntLog.IP != "" || dntLog.UserAgent != "" || dntLog.Location != "重庆市 电信" {
		t.Fatalf("dnt log stores too much: %+v", dntLog)
	}

	// 6. 非法路径被拒绝
	if _, svcerr := svc.Report(anon, &dto.ReportVisitReq{Path: "http://evil"}, "", testIP, testChromeUA, false); svcerr == nil {
		t.Fatalf("invalid path should be rejected")
	}

	// 站内跳转（来源为本站域名）不计入来源排行
	if _, svcerr := svc.Report(anon, &dto.ReportVisitReq{Path: "/c/go", Referrer: "https://blog.example.com/a"}, key, testIP, testChromeUA, false, "blog.example.com"); svcerr != nil {
		t.Fatalf("internal report: %v", svcerr)
	}
	var internalLog model.VisitLog
	repo.GetDB().Last(&internalLog)
	if internalLog.Source != "internal" {
		t.Fatalf("internal navigation source: %q", internalLog.Source)
	}

	// 7. 后台统计与列表：文章标题、IP 脱敏、只看登录用户
	stats, _ := svc.GetStats(admin)
	if stats.TodayPV != 6 || stats.TodayUV != 2 || stats.TodayUserVisits != 1 || stats.TotalVisitors != 2 {
		t.Fatalf("unexpected stats: %+v", stats)
	}
	// 来源排行：直接访问 4 次排第一，谷歌 1 次，站内跳转不计入
	sources := map[string]int64{}
	for _, item := range stats.TodaySources {
		sources[item.Source] = item.Count
	}
	if len(sources) != 2 || sources["direct"] != 4 || sources["google"] != 1 || stats.TodaySources[0].Source != "direct" {
		t.Fatalf("unexpected today sources: %+v", stats.TodaySources)
	}
	googleItems, googleTotal, _ := svc.ListVisitLogs(admin, &dto.ListVisitLogReq{Source: "google", PaginationParams: dto.PaginationParams{Page: 1, Size: 10}})
	if googleTotal != 1 || googleItems[0].Source != "google" || googleItems[0].SourceHost != "google.com" {
		t.Fatalf("source filter: total=%d items=%+v", googleTotal, googleItems)
	}
	items, total, svcerr := svc.ListVisitLogs(admin, &dto.ListVisitLogReq{PaginationParams: dto.PaginationParams{Page: 1, Size: 10}})
	if svcerr != nil || total != 6 {
		t.Fatalf("list: total=%d err=%v", total, svcerr)
	}
	last := items[len(items)-1]
	if last.Subject == nil || last.Subject.Title != post.Title || last.IP != "222.178.*.*" {
		t.Fatalf("first log dto: subject=%+v ip=%q", last.Subject, last.IP)
	}
	userItems, userTotal, _ := svc.ListVisitLogs(admin, &dto.ListVisitLogReq{Kind: "user", PaginationParams: dto.PaginationParams{Page: 1, Size: 10}})
	if userTotal != 1 || userItems[0].User == nil || userItems[0].User.Username != "author" {
		t.Fatalf("user filter: total=%d items=%+v", userTotal, userItems)
	}
}
