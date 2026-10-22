package service

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
)

// countJobs 统计处于指定状态的任务数
func countJobs(s *AISummaryService, status string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, job := range s.jobs {
		if job.status == status {
			n++
		}
	}
	return n
}

func TestAISummaryTriggerAllAndConcurrency(t *testing.T) {
	author, admin, _, post, _ := setupEditTest(t)
	s := NewAISummaryService()
	s.mu.Lock()
	s.jobs = make(map[uint]*aiSummaryJob)
	s.mu.Unlock()

	release := make(chan struct{})
	var inFlight, maxInFlight atomic.Int32
	s.complete = func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		n := inFlight.Add(1)
		for {
			m := maxInFlight.Load()
			if n <= m || maxInFlight.CompareAndSwap(m, n) {
				break
			}
		}
		<-release
		inFlight.Add(-1)
		return "批量生成的摘要。", nil
	}
	s.concurrency = func() int { return 1 }
	defer func() {
		s.complete = chatCompletion
		s.concurrency = tools.GetAISummaryConcurrency
	}()

	// 未配置 AI 时拒绝
	if _, svcerr := s.TriggerAll(admin, false); svcerr == nil || svcerr.Code != http.StatusBadRequest {
		t.Fatalf("expected ai_not_configured, got %v", svcerr)
	}
	for k, v := range map[string]string{"ai_api_base_url": "https://example.com/v1", "ai_api_key": "sk-test", "ai_model": "test-model"} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatalf("set kv: %v", err)
		}
	}
	// 只有管理员可以全站生成
	if _, svcerr := s.TriggerAll(author, false); svcerr == nil || svcerr.Code != http.StatusForbidden {
		t.Fatalf("non-admin should be forbidden, got %v", svcerr)
	}

	create := func(title, content, description, aiSummary, sourceHash string) *model.Post {
		t.Helper()
		p := &model.Post{
			UserID:              post.UserID,
			PostBase:            model.PostBase{Title: title, Content: content, Description: description},
			AISummary:           aiSummary,
			AISummarySourceHash: sourceHash,
		}
		if err := repo.GetDB().Create(p).Error; err != nil {
			t.Fatalf("create post: %v", err)
		}
		return p
	}
	manual := create("manual", "<p>a</p>", "手写描述", "", "")
	create("empty", "", "", "", "")
	upToDate := create("fresh", "<p>b</p>", "已是最新", "已是最新", model.HashContent("<p>b</p>"))
	stale := create("stale", "<p>c</p>", "旧摘要", "旧摘要", "outdated")

	result, svcerr := s.TriggerAll(admin, false)
	if svcerr != nil {
		t.Fatalf("trigger all: %v", svcerr)
	}
	// 原始文章与过期摘要入队；手写描述、空正文、最新摘要跳过
	want := dto.BatchAISummaryResultDto{Queued: 2, SkippedManual: 1, SkippedEmpty: 1, SkippedUpToDate: 1}
	if *result != want {
		t.Fatalf("unexpected result: %+v", *result)
	}
	// 任务仍在进行时再次触发，全部计为进行中
	if again, _ := s.TriggerAll(admin, false); again.Queued != 0 || again.SkippedRunning != 2 {
		t.Fatalf("running jobs should be skipped: %+v", *again)
	}
	// 并发上限为 1：一个生成中，一个排队
	deadline := time.Now().Add(2 * time.Second)
	for countJobs(s, aiSummaryStatusRunning) != 1 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if r, q := countJobs(s, aiSummaryStatusRunning), countJobs(s, aiSummaryStatusQueued); r != 1 || q != 1 {
		t.Fatalf("expected 1 running and 1 queued, got %d running %d queued", r, q)
	}

	close(release)
	waitAISummary(t, s, admin, post.ID)
	waitAISummary(t, s, admin, stale.ID)
	if got := maxInFlight.Load(); got != 1 {
		t.Fatalf("concurrency limit not respected, max in flight %d", got)
	}
	if got := reloadPost(t, stale.ID); got.Description != "批量生成的摘要。" || got.AISummaryStale() {
		t.Fatalf("stale post not regenerated: %+v", got.Description)
	}
	if got := reloadPost(t, manual.ID); got.Description != "手写描述" {
		t.Fatalf("manual description should be kept, got %q", got.Description)
	}
	if got := reloadPost(t, upToDate.ID); got.Description != "已是最新" {
		t.Fatalf("up-to-date summary should not change, got %q", got.Description)
	}

	// 选择覆盖手写描述时，只有手写描述那篇需要生成
	result, svcerr = s.TriggerAll(admin, true)
	if svcerr != nil {
		t.Fatalf("trigger all overwrite: %v", svcerr)
	}
	if result.Queued != 1 || result.SkippedUpToDate != 3 {
		t.Fatalf("unexpected overwrite result: %+v", *result)
	}
	waitAISummary(t, s, admin, manual.ID)
	if got := reloadPost(t, manual.ID); got.Description != "批量生成的摘要。" {
		t.Fatalf("manual description should be overwritten, got %q", got.Description)
	}
}
