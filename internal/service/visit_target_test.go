package service

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func lastVisitLog(t *testing.T, path string) model.VisitLog {
	t.Helper()
	var log model.VisitLog
	if err := repo.GetDB().Where("path = ?", path).Order("id DESC").First(&log).Error; err != nil {
		t.Fatalf("visit %s: %v", path, err)
	}
	return log
}

// 上报的目标来自浏览器：只有公开的文章记为目标并加浏览量，私密（前台 404）与不存在的按其他页面记录
func TestVisitReportTargetVisibility(t *testing.T) {
	author, _, _, privatePost, _ := setupEditTest(t)
	publicID := createPublicPost(t, author, nil)
	svc := NewVisitService()
	anon := context.Background()
	report := func(path string, targetID uint) {
		t.Helper()
		req := &dto.ReportVisitReq{Path: path, TargetType: constant.TargetTypePost, TargetID: targetID}
		if _, svcerr := svc.Report(anon, req, "", VisitClient{IP: testIP, UserAgent: testChromeUA}); svcerr != nil {
			t.Fatalf("report %s: %v", path, svcerr)
		}
	}
	report("/p/public", publicID)
	report("/p/private", privatePost.ID)
	report("/p/missing", 999999)
	if log := lastVisitLog(t, "/p/public"); log.TargetType != constant.TargetTypePost || log.TargetID != publicID {
		t.Errorf("public target = %s %d", log.TargetType, log.TargetID)
	}
	for _, path := range []string{"/p/private", "/p/missing"} {
		if log := lastVisitLog(t, path); log.TargetType != "other" || log.TargetID != 0 {
			t.Errorf("%s target = %s %d, want other", path, log.TargetType, log.TargetID)
		}
	}
	if stats, svcerr := NewPostService().GetPublicPostStats(publicID); svcerr != nil || stats.ViewCount != 1 {
		t.Errorf("public live view count = %v (err=%v), want 1", stats, svcerr)
	}
	FlushPostViewCounts()
	if got := reloadPost(t, publicID).ViewCount; got != 1 {
		t.Errorf("public view count = %d, want 1", got)
	}
	if got := reloadPost(t, privatePost.ID).ViewCount; got != 0 {
		t.Errorf("private view count = %d, want 0", got)
	}
}

// 同一访客并发上报（多个标签页）：访问次数原子累加，与记录条数一致
func TestVisitCountConcurrent(t *testing.T) {
	setupEditTest(t)
	svc := NewVisitService()
	anon := context.Background()
	client := VisitClient{IP: testIP, UserAgent: testChromeUA}
	key, svcerr := svc.Report(anon, &dto.ReportVisitReq{Path: "/c/0"}, "", client)
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	var wg sync.WaitGroup
	for i := 1; i <= 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, svcerr := svc.Report(anon, &dto.ReportVisitReq{Path: fmt.Sprintf("/c/%d", i)}, key, client); svcerr != nil {
				t.Errorf("report %d: %v", i, svcerr)
			}
		}()
	}
	wg.Wait()
	visitor, err := repo.Visit.GetVisitorByKey(key)
	if err != nil {
		t.Fatal(err)
	}
	var logs int64
	repo.GetDB().Model(&model.VisitLog{}).Where("visitor_id = ?", visitor.ID).Count(&logs)
	if visitor.VisitCount != 9 || logs != 9 {
		t.Fatalf("visit count = %d, logs = %d, want 9", visitor.VisitCount, logs)
	}
}

// 登录用户只在登录后第一次上报时补记匿名访问（共享状态记下补记过的用户）；登出后的匿名浏览清掉标记
func TestVisitAttributionOncePerLogin(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	svc := NewVisitService()
	anon := context.Background()
	authorUser, _ := repo.User.GetUserByUsername("author")
	client := VisitClient{IP: testIP, UserAgent: testChromeUA}
	report := func(ctx context.Context, path, key string) string {
		t.Helper()
		got, svcerr := svc.Report(ctx, &dto.ReportVisitReq{Path: path}, key, client)
		if svcerr != nil {
			t.Fatal(svcerr)
		}
		return got
	}
	key := report(anon, "/a/1", "")
	report(author, "/a/2", key)
	visitor, _ := repo.Visit.GetVisitorByKey(key)
	markKey := visitAttributionKey(visitor.ID)
	if v, ok, _ := sharedstate.Current().Get(markKey); !ok || v != strconv.FormatUint(uint64(authorUser.ID), 10) {
		t.Fatalf("attribution mark = %q %v", v, ok)
	}
	assertOwner(t, "/a/1", &authorUser.ID, constant.VisitUserSourceBrowser)
	if claimVisitAttribution(visitor.ID, authorUser.ID) {
		t.Fatal("second report of the same login should not attribute again")
	}
	// 登出后的匿名浏览清掉标记，再次登录时补记这段
	report(anon, "/a/3", key)
	if _, ok, _ := sharedstate.Current().Get(markKey); ok {
		t.Fatal("anonymous visit after logout should reset the mark")
	}
	report(author, "/a/4", key)
	assertOwner(t, "/a/3", &authorUser.ID, constant.VisitUserSourceBrowser)
}
