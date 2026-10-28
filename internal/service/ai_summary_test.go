package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/errs"
)

func waitAISummary(t *testing.T, s *AISummaryService, ctx context.Context, postID uint) *dto.AISummaryStatusDto {
	t.Helper()
	for range 100 {
		st, svcerr := s.Status(ctx, postID)
		if svcerr != nil {
			t.Fatalf("status: %v", svcerr)
		}
		if st.Status != aiSummaryStatusRunning && st.Status != aiSummaryStatusQueued {
			return st
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("ai summary job did not finish")
	return nil
}

func TestAISummaryLifecycle(t *testing.T) {
	author, _, other, post, _ := setupEditTest(t)
	s := NewAISummaryService()
	release := make(chan struct{})
	s.complete = func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		<-release
		return "  \"<think>思考</think>\n## 标题\n用 **Tiptap** 重写编辑器，并补齐 `slash` 命令。\"  ", nil
	}
	defer func() { s.complete = chatCompletion }()

	// 未配置 AI 时拒绝
	expectCode(t, s.Trigger(author, post.ID), http.StatusBadRequest, "not configured")
	for k, v := range map[string]string{"ai_api_base_url": "https://example.com/v1", "ai_api_key": "sk-test", "ai_model": "test-model"} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatalf("set kv: %v", err)
		}
	}
	// 只有作者或管理员可以触发
	expectCode(t, s.Trigger(other, post.ID), http.StatusForbidden, "other user")

	if svcerr := s.Trigger(author, post.ID); svcerr != nil {
		t.Fatalf("trigger: %v", svcerr)
	}
	// 同一文章任务进行中时不能重复触发
	expectCode(t, s.Trigger(author, post.ID), http.StatusConflict, "duplicate trigger")
	close(release)
	st := waitAISummary(t, s, author, post.ID)
	if st.Status != aiSummaryStatusSucceeded || st.Stale {
		t.Fatalf("unexpected status: %+v", st)
	}
	want := "用 **Tiptap** 重写编辑器，并补齐 `slash` 命令。"
	if st.Description != want {
		t.Fatalf("summary should be normalized, got %q", st.Description)
	}
	saved := reloadPost(t, post.ID)
	if saved.AISummary != want || saved.AISummaryAt == nil || !saved.ToDto().DescriptionByAI {
		t.Fatalf("summary not saved: %+v", saved.AISummary)
	}

	// 正文更新后提示摘要过期
	content := "<p>新的正文</p>"
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{Content: content}}); svcerr != nil {
		t.Fatalf("update post: %v", svcerr)
	}
	if st, _ := s.Status(author, post.ID); !st.Stale {
		t.Fatalf("summary should be stale after content changes")
	}
	// 手动修改摘要后不再视为 AI 摘要
	desc := "手写摘要"
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, Description: &desc}); svcerr != nil {
		t.Fatalf("update description: %v", svcerr)
	}
	if reloadPost(t, post.ID).ToDto().DescriptionByAI {
		t.Fatalf("manually edited description should not be marked as AI")
	}
}

func TestAISummaryFailureStatus(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	s := NewAISummaryService()
	s.complete = func(ctx context.Context, cfg tools.AIConfig, system, user string) (string, error) {
		return "", errs.NewInternalServer("status 401: invalid api key")
	}
	defer func() { s.complete = chatCompletion }()
	for k, v := range map[string]string{"ai_api_base_url": "https://example.com/v1", "ai_api_key": "sk-test", "ai_model": "m"} {
		_ = repo.KV.SetKV(k, v)
	}
	if svcerr := s.Trigger(author, post.ID); svcerr != nil {
		t.Fatalf("trigger: %v", svcerr)
	}
	st := waitAISummary(t, s, author, post.ID)
	if st.Status != aiSummaryStatusFailed || st.Error == "" {
		t.Fatalf("expected failed status, got %+v", st)
	}
	// 失败后可以重新触发
	if svcerr := s.Trigger(author, post.ID); svcerr != nil {
		t.Fatalf("retry after failure should be allowed: %v", svcerr)
	}
	waitAISummary(t, s, author, post.ID)
	_ = context.Background()
}

func TestHTMLToPlainText(t *testing.T) {
	got := htmlToPlainText(`<h2>标题</h2><p>段落 &amp; <strong>加粗</strong></p><ul><li>一</li><li>二</li></ul><pre><code>go run .</code></pre>`)
	for _, part := range []string{"## 标题", "段落 & 加粗", "- 一", "- 二", "```\ngo run .\n```"} {
		if !contains(got, part) {
			t.Fatalf("plain text missing %q:\n%s", part, got)
		}
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestTruncateSummary(t *testing.T) {
	long := strings.Repeat("这是一句用于测试截断的中文摘要。", 30)
	got := truncateSummary(long)
	if r := []rune(got); len(r) > aiSummaryMaxOutputRune || !strings.HasSuffix(got, "。") {
		t.Fatalf("chinese summary should be cut at sentence end within limit, got %d runes", len(r))
	}
	english := strings.Repeat("This sentence keeps the English summary long enough. ", 15)
	if got := truncateSummary(strings.TrimSpace(english)); len([]rune(got)) <= aiSummaryMaxOutputRune {
		t.Fatalf("english summary should use the larger latin limit, got %d chars", len([]rune(got)))
	}
}

func TestClearDescriptionAndCover(t *testing.T) {
	author, _, _, post, _ := setupEditTest(t)
	cover, desc := "https://example.com/a.png", "摘要"
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, Cover: &cover, Description: &desc}); svcerr != nil {
		t.Fatalf("set: %v", svcerr)
	}
	empty := ""
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, Cover: &empty, Description: &empty}); svcerr != nil {
		t.Fatalf("clear: %v", svcerr)
	}
	if p := reloadPost(t, post.ID); p.Cover != "" || p.Description != "" {
		t.Fatalf("cover and description should be cleared, got %q %q", p.Cover, p.Description)
	}
	// 未传字段保持原值
	title := "新标题"
	if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: post.ID, PostBaseDto: dto.PostBaseDto{Title: title}}); svcerr != nil {
		t.Fatalf("title: %v", svcerr)
	}
}

func TestChatCompletionReasoningFallback(t *testing.T) {
	var withEffort, without atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["reasoning_effort"] != nil {
			// 不支持该参数的接口
			withEffort.Add(1)
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"unknown parameter reasoning_effort"}`))
			return
		}
		without.Add(1)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	t.Cleanup(server.Close)
	cfg := tools.AIConfig{BaseURL: server.URL, Model: "m"}

	// 第一次带参数被拒，去掉参数重试成功；之后不再携带
	for range 2 {
		got, err := chatCompletionWithReasoning(context.Background(), cfg, "s", "u", 0.5, "none")
		if err != nil || got != "ok" {
			t.Fatalf("got %q, %v", got, err)
		}
	}
	if withEffort.Load() != 1 || without.Load() != 2 {
		t.Fatalf("calls with effort = %d, without = %d", withEffort.Load(), without.Load())
	}
}
