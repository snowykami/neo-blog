package service

import (
	"context"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// visitOwner 某条访问记录（按路径）当前归属的用户与来源
func visitOwner(t *testing.T, path string) (*uint, string) {
	t.Helper()
	var log model.VisitLog
	if err := repo.GetDB().Where("path = ?", path).Order("id DESC").First(&log).Error; err != nil {
		t.Fatalf("visit %s: %v", path, err)
	}
	return log.UserID, log.UserSource
}

func assertOwner(t *testing.T, path string, want *uint, wantSource string) {
	t.Helper()
	got, source := visitOwner(t, path)
	if (got == nil) != (want == nil) || (got != nil && *got != *want) || source != wantSource {
		t.Fatalf("%s: owner=%v source=%q, want %v %q", path, got, source, want, wantSource)
	}
}

func TestVisitAttribution(t *testing.T) {
	author, _, other, _, _ := setupEditTest(t)
	svc := NewVisitService()
	anon := context.Background()
	authorUser, _ := repo.User.GetUserByUsername("author")
	otherUser, _ := repo.User.GetUserByUsername("other")
	client := func(ip string) VisitClient { return VisitClient{IP: ip, UserAgent: testChromeUA} }
	report := func(ctx context.Context, path, key, fp, ip string) string {
		t.Helper()
		got, svcerr := svc.Report(ctx, &dto.ReportVisitReq{Path: path, Fingerprint: fp}, key, client(ip))
		if svcerr != nil {
			t.Fatalf("report %s: %v", path, svcerr)
		}
		return got
	}

	// 1. 同一浏览器：匿名浏览后登录，登录前的访问补记到该用户；登录后回到刚看过的页面（被去重）也会补记
	key := report(anon, "/b/1", "", testFP, testIP)
	report(anon, "/b/2", key, testFP, testIP)
	before := countVisitLogs(t)
	report(author, "/b/2", key, testFP, testIP)
	if countVisitLogs(t) != before {
		t.Fatal("revisit within dedup window should not add a log")
	}
	assertOwner(t, "/b/1", &authorUser.ID, constant.VisitUserSourceBrowser)
	assertOwner(t, "/b/2", &authorUser.ID, constant.VisitUserSourceBrowser)

	// 登录时的访问不标来源
	report(author, "/b/3", key, testFP, testIP)
	assertOwner(t, "/b/3", &authorUser.ID, "")

	// 2. 共用电脑：author 退出后的匿名浏览归给之后登录的 other，author 登录期间之前的记录不变
	report(anon, "/b/4", key, testFP, testIP)
	report(other, "/b/5", key, testFP, testIP)
	assertOwner(t, "/b/4", &otherUser.ID, constant.VisitUserSourceBrowser)
	assertOwner(t, "/b/1", &authorUser.ID, constant.VisitUserSourceBrowser)

	// 3. 指纹推断：另一个访客（不同 Cookie、同一指纹、从未登录）只有来自同一 IP 段的访问会补记
	const fp2 = "fedcba9876543210fedcba9876543210"
	mine := report(anon, "/f/mine", "", fp2, "222.178.20.1")
	twin := report(anon, "/f/away", "", fp2, "113.92.157.29") // 当时不同网段，成为另一个访客
	if twin == mine {
		t.Fatal("different network should create another visitor")
	}
	report(anon, "/f/near", twin, fp2, "222.178.20.77")
	report(author, "/f/login", mine, fp2, "222.178.20.1")
	assertOwner(t, "/f/near", &authorUser.ID, constant.VisitUserSourceFingerprint)
	assertOwner(t, "/f/away", nil, "")
	assertOwner(t, "/f/mine", &authorUser.ID, constant.VisitUserSourceBrowser)

	// 被其他用户登录过的访客不参与推断
	const fp3 = "00112233445566778899aabbccddeeff"
	taken := report(anon, "/t/away", "", fp3, "113.92.157.30")
	report(other, "/t/other", taken, fp3, "113.92.157.30")
	report(anon, "/t/near", taken, fp3, "222.178.30.5")
	fresh := report(anon, "/t/mine", "", fp3, "113.92.200.1")
	report(author, "/t/login", fresh, fp3, "222.178.30.9")
	assertOwner(t, "/t/near", nil, "")

	// 4. 关闭指纹推断后只按同一浏览器补记
	if err := repo.KV.SetKV("visit_fingerprint_attribution", false); err != nil {
		t.Fatalf("set kv: %v", err)
	}
	const fp4 = "0f1e2d3c4b5a69780f1e2d3c4b5a6978"
	solo := report(anon, "/o/mine", "", fp4, "222.178.40.1")
	twin4 := report(anon, "/o/away", "", fp4, "113.92.157.40")
	report(anon, "/o/near", twin4, fp4, "222.178.40.2")
	report(author, "/o/login", solo, fp4, "222.178.40.1")
	assertOwner(t, "/o/near", nil, "")
	assertOwner(t, "/o/mine", &authorUser.ID, constant.VisitUserSourceBrowser)

	// 5. 请勿追踪的访问不关联访客，也不会被补记
	if _, svcerr := svc.Report(anon, &dto.ReportVisitReq{Path: "/d/dnt", Fingerprint: testFP}, "", VisitClient{IP: testIP, UserAgent: testChromeUA, DoNotTrack: true}); svcerr != nil {
		t.Fatalf("dnt report: %v", svcerr)
	}
	report(author, "/d/login", key, testFP, testIP)
	assertOwner(t, "/d/dnt", nil, "")

	// 后台时间线带出归属来源
	items, _, svcerr := svc.ListVisitLogs(adminCtx(t), &dto.ListVisitLogReq{VisitorID: 0, PaginationParams: dto.PaginationParams{Page: 1, Size: 100}})
	if svcerr != nil {
		t.Fatalf("list: %v", svcerr)
	}
	sources := map[string]string{}
	for _, item := range items {
		sources[item.Path] = item.UserSource
	}
	if sources["/b/1"] != constant.VisitUserSourceBrowser || sources["/f/near"] != constant.VisitUserSourceFingerprint || sources["/b/3"] != "" {
		t.Fatalf("dto user source: %+v", sources)
	}
}

// adminCtx 以测试库中的管理员身份查询后台
func adminCtx(t *testing.T) context.Context {
	t.Helper()
	admin, err := repo.User.GetUserByUsername("admin")
	if err != nil {
		t.Fatalf("admin: %v", err)
	}
	return context.WithValue(context.Background(), "user_id", admin.ID)
}
