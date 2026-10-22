package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
)

func configureAI(t *testing.T, baseURL string) {
	t.Helper()
	for k, v := range map[string]string{"ai_api_base_url": baseURL, "ai_api_key": "sk-test", "ai_model": "test-model"} {
		if err := repo.KV.SetKV(k, v); err != nil {
			t.Fatalf("set kv: %v", err)
		}
	}
}

func writeReq(document string) *dto.AIWriteReq {
	return &dto.AIWriteReq{Mode: aiWriteModeWrite, Document: document, Title: "Tiptap 实践"}
}

func expectMessage(t *testing.T, svcerr *errs.ServiceError, code int, message string) {
	t.Helper()
	if svcerr == nil || svcerr.Code != code || svcerr.Message != message {
		t.Fatalf("want %d %s, got %+v", code, message, svcerr)
	}
}

// 权限与编辑权限一致：作者或管理员；未配置 AI、输入不合法时拒绝
func TestAIWritePrepare(t *testing.T) {
	author, admin, other, post, _ := setupEditTest(t)
	s := NewAIWriteService()
	doc := "<p>前文" + aiWriteInsertMarker + "后文</p>"

	expectMessage(t, prepareErr(s, other, constant.TargetTypePost, post.ID, writeReq(doc)), http.StatusForbidden, "permission_denied")
	expectMessage(t, prepareErr(s, author, constant.TargetTypePost, post.ID, writeReq(doc)), http.StatusBadRequest, "ai_not_configured")
	configureAI(t, "https://example.com/v1")
	expectMessage(t, prepareErr(s, other, constant.TargetTypePost, post.ID, writeReq(doc)), http.StatusForbidden, "permission_denied")
	expectCode(t, prepareErr(s, author, constant.TargetTypePost, 99999, writeReq(doc)), http.StatusNotFound, "missing post")

	for name, ctx := range map[string]context.Context{"author": author, "admin": admin} {
		job, svcerr := s.Prepare(ctx, constant.TargetTypePost, post.ID, writeReq(doc))
		if svcerr != nil {
			t.Fatalf("%s prepare: %v", name, svcerr)
		}
		if !strings.Contains(job.user, "前文"+aiWriteInsertMarker+"后文") || !strings.Contains(job.user, "Tiptap 实践") {
			t.Fatalf("%s prompt missing context: %s", name, job.user)
		}
	}

	// 页面使用页面的作者判断权限
	pageID, svcerr := NewPageService().CreatePage(author, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "关于", Slug: "about", Content: "<p>hi</p>"}})
	if svcerr != nil {
		t.Fatalf("create page: %v", svcerr)
	}
	if _, svcerr := s.Prepare(author, constant.TargetTypePage, pageID, writeReq(doc)); svcerr != nil {
		t.Fatalf("page author prepare: %v", svcerr)
	}
	expectCode(t, prepareErr(s, other, constant.TargetTypePage, pageID, writeReq(doc)), http.StatusForbidden, "page other user")

	// 输入校验
	bad := writeReq(doc)
	bad.Mode = "translate"
	expectMessage(t, prepareErr(s, author, constant.TargetTypePost, post.ID, bad), http.StatusBadRequest, "invalid_request_parameters")
	bad = writeReq(doc)
	bad.Preset = "polish" // 润色的快捷指令不能用于帮写
	expectMessage(t, prepareErr(s, author, constant.TargetTypePost, post.ID, bad), http.StatusBadRequest, "invalid_request_parameters")
	expectMessage(t, prepareErr(s, author, constant.TargetTypePost, post.ID, writeReq("<p>没有标记</p>")), http.StatusBadRequest, "invalid_request_parameters")
	expectMessage(t, prepareErr(s, author, constant.TargetTypePost, post.ID, writeReq(doc+doc)), http.StatusBadRequest, "invalid_request_parameters")
	long := writeReq(doc)
	long.Instruction = strings.Repeat("长", aiWriteMaxInstructionRune+1)
	expectMessage(t, prepareErr(s, author, constant.TargetTypePost, post.ID, long), http.StatusBadRequest, "ai_input_too_long")

	rewrite := &dto.AIWriteReq{Mode: aiWriteModeRewrite, Document: "<p>a" + aiWriteSelectionStart + " " + aiWriteSelectionEnd + "b</p>"}
	expectMessage(t, prepareErr(s, author, constant.TargetTypePost, post.ID, rewrite), http.StatusBadRequest, "ai_write_empty_selection")
	rewrite.Document = "<p>" + aiWriteSelectionStart + strings.Repeat("字", aiWriteMaxSelectionRune+1) + aiWriteSelectionEnd + "</p>"
	expectMessage(t, prepareErr(s, author, constant.TargetTypePost, post.ID, rewrite), http.StatusBadRequest, "ai_input_too_long")
	rewrite.Document = "<p>" + aiWriteSelectionEnd + "反了" + aiWriteSelectionStart + "</p>"
	expectMessage(t, prepareErr(s, author, constant.TargetTypePost, post.ID, rewrite), http.StatusBadRequest, "invalid_request_parameters")
}

func prepareErr(s *AIWriteService, ctx context.Context, targetType string, id uint, req *dto.AIWriteReq) *errs.ServiceError {
	_, svcerr := s.Prepare(ctx, targetType, id, req)
	return svcerr
}

// 提示词：正文转纯文本、选区单独给出、按位置给出不同要求、空要求使用默认要求
func TestBuildAIWritePrompt(t *testing.T) {
	text := htmlToPlainText("<h2>背景</h2><p>第一段" + aiWriteSelectionStart + "<strong>需要润色</strong>的句子" + aiWriteSelectionEnd + "。</p><table><tr><th>键</th><th>值</th></tr></table>")
	before, selection, after, ok := splitAIWriteDocument(text, aiWriteModeRewrite)
	if !ok || before != "## 背景\n第一段" || selection != "需要润色的句子" || !strings.HasPrefix(after, "。") {
		t.Fatalf("split rewrite: ok=%v before=%q selection=%q after=%q", ok, before, selection, after)
	}
	if !strings.Contains(after, "键 | 值") {
		t.Fatalf("table cells should be separated: %q", after)
	}

	p := &aiWritePrompt{
		targetType: constant.TargetTypePost, mode: aiWriteModeRewrite, scope: aiWriteScopeInline,
		title: "标题", category: "笔记", labels: []string{"go", "tiptap"},
		before: before, selection: selection, after: after,
	}
	got := p.build()
	for _, want := range []string{"- 标题：标题", "- 描述：（无）", "- 分类：笔记", "- 标签：go、tiptap", "第一段" + aiWriteSelectionMarker + "。", "# 选中内容\n<<<\n需要润色的句子\n>>>", "不要换行", "润色选中内容"} {
		if !strings.Contains(got, want) {
			t.Fatalf("prompt missing %q:\n%s", want, got)
		}
	}
	// 选中内容只在单独一节出现，正文中只有占位
	if strings.Count(got, "需要润色的句子") != 1 || strings.Contains(got, aiWriteSelectionStart) {
		t.Fatalf("selection should appear once:\n%s", got)
	}

	p.preset, p.instruction = "translate_en", "保留 emoji"
	if got = p.build(); !strings.Contains(got, "翻译成英文") || !strings.Contains(got, "补充要求：保留 emoji") {
		t.Fatalf("preset with instruction:\n%s", got)
	}

	page := &aiWritePrompt{targetType: constant.TargetTypePage, mode: aiWriteModeWrite, scope: aiWriteScopeCode, instruction: "补一个示例", before: "a", after: "b"}
	got = page.build()
	for _, want := range []string{"独立页面", "a" + aiWriteInsertMarker + "b", "代码块", "补一个示例"} {
		if !strings.Contains(got, want) {
			t.Fatalf("page prompt missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "分类") {
		t.Fatalf("page prompt should not contain category:\n%s", got)
	}
}

// 前后文超长时保留离插入点最近的内容，一侧较短时额度让给另一侧
func TestTruncateAIWriteContext(t *testing.T) {
	before, after := truncateAIWriteContext("0123456789", "abcdefghij", 6)
	if !strings.HasSuffix(before, "6789") || !strings.HasPrefix(after, "ab") || strings.Contains(after, "c") {
		t.Fatalf("unexpected truncation: %q %q", before, after)
	}
	before, after = truncateAIWriteContext("01", "abcdefghij", 6)
	if before != "01" || !strings.HasPrefix(after, "abcd") || strings.Contains(after, "e") {
		t.Fatalf("short before should give quota to after: %q %q", before, after)
	}
	before, after = truncateAIWriteContext("短", "文", 6)
	if before != "短" || after != "文" {
		t.Fatalf("short context should be kept: %q %q", before, after)
	}
}

func TestThinkTagFilter(t *testing.T) {
	run := func(chunks ...string) (string, bool) {
		f := &thinkTagFilter{}
		var out strings.Builder
		sawThinking := false
		for _, c := range chunks {
			text, thinking := f.push(c)
			sawThinking = sawThinking || thinking
			out.WriteString(text)
		}
		out.WriteString(f.flush())
		return out.String(), sawThinking
	}
	if got, thinking := run("\n<th", "ink>想一想", "…</th", "ink>\n\n正文", "继续"); got != "正文继续" || !thinking {
		t.Fatalf("think block should be removed, got %q thinking=%v", got, thinking)
	}
	if got, _ := run("\n\n## 标题", "\n内容 <think> 不是开头"); got != "## 标题\n内容 <think> 不是开头" {
		t.Fatalf("plain content should pass through, got %q", got)
	}
	if got, _ := run("<thi"); got != "<thi" {
		t.Fatalf("partial tag at end should be flushed, got %q", got)
	}
}

// 上游 SSE：忽略思考内容与注释行，遇到 [DONE] 结束；错误状态与错误事件返回错误
func TestChatCompletionStream(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		switch r.URL.Path {
		case "/ok/chat/completions":
			w.Header().Set("Content-Type", "text/event-stream")
			flusher := w.(http.Flusher)
			for _, line := range []string{
				`: keep-alive`,
				`data: {"choices":[{"delta":{"role":"assistant","content":""}}]}`,
				`data: {"choices":[{"delta":{"reasoning_content":"先想想"}}]}`,
				`data: {"choices":[{"delta":{"content":"你好"}}]}`,
				`data: {"choices":[{"delta":{"content":"，世界"},"finish_reason":"stop"}]}`,
				`data: [DONE]`,
				`data: {"choices":[{"delta":{"content":"不应出现"}}]}`,
			} {
				_, _ = fmt.Fprintf(w, "%s\n\n", line)
				flusher.Flush()
			}
		case "/json/chat/completions":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{"choices":[{"message":{"content":"一次性返回"}}]}`)
		case "/stream-error/chat/completions":
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprint(w, "data: {\"error\":{\"message\":\"quota exceeded\"}}\n\n")
		default:
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = fmt.Fprint(w, `{"error":{"message":"invalid key"}}`)
		}
	}))
	defer srv.Close()

	collect := func(base string) (string, []string, error) {
		var content strings.Builder
		var reasoning []string
		err := chatCompletionStream(context.Background(), tools.AIConfig{BaseURL: srv.URL + base, APIKey: "k", Model: "m"}, "sys", "user", func(c, r string) error {
			content.WriteString(c)
			if r != "" {
				reasoning = append(reasoning, r)
			}
			return nil
		})
		return content.String(), reasoning, err
	}

	content, reasoning, err := collect("/ok")
	if err != nil || content != "你好，世界" || !slices.Equal(reasoning, []string{"先想想"}) {
		t.Fatalf("stream: content=%q reasoning=%v err=%v", content, reasoning, err)
	}
	if !strings.Contains(gotBody, `"stream":true`) || strings.Contains(gotBody, "temperature") {
		t.Fatalf("request body should enable stream without sampling params: %s", gotBody)
	}
	if content, _, err := collect("/json"); err != nil || content != "一次性返回" {
		t.Fatalf("json fallback: %q %v", content, err)
	}
	if _, _, err := collect("/stream-error"); err == nil || !strings.Contains(err.Error(), "quota exceeded") {
		t.Fatalf("stream error should be returned, got %v", err)
	}
	if _, _, err := collect("/bad"); err == nil || !strings.Contains(err.Error(), "status 401") {
		t.Fatalf("status error should be returned, got %v", err)
	}
}

type recordedEvent struct {
	event string
	data  any
}

type eventRecorder struct {
	mu     sync.Mutex
	events []recordedEvent
}

func (r *eventRecorder) emit(event string, data any) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if event != AIWriteEventPing {
		r.events = append(r.events, recordedEvent{event, data})
	}
	return nil
}

func (r *eventRecorder) names() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	names := make([]string, len(r.events))
	for i, e := range r.events {
		names[i] = e.event
	}
	return names
}

func newTestAIWriteService(stream aiStreamFunc, concurrency int) *AIWriteService {
	return &AIWriteService{
		running:     make(map[uint]*aiWriteRun),
		limiter:     &aiLimiter{},
		stream:      stream,
		concurrency: func() int { return concurrency },
		heartbeat:   time.Hour,
	}
}

// 推送顺序：思考 → 片段 → 完成；出错或无内容时推送错误
func TestAIWriteStreamEvents(t *testing.T) {
	s := newTestAIWriteService(func(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(string, string) error) error {
		for _, c := range [][2]string{{"", "思考"}, {"<think>x</think>\n", ""}, {"第一段", ""}, {"\n\n第二段", ""}} {
			if err := onChunk(c[0], c[1]); err != nil {
				return err
			}
		}
		return nil
	}, 1)
	rec := &eventRecorder{}
	s.Stream(context.Background(), &AIWriteJob{userID: 1}, rec.emit)
	if got := rec.names(); !slices.Equal(got, []string{AIWriteEventThinking, AIWriteEventDelta, AIWriteEventDelta, AIWriteEventDone}) {
		t.Fatalf("unexpected events: %v", got)
	}
	if text := rec.events[1].data.(map[string]string)["text"]; text != "第一段" {
		t.Fatalf("unexpected first delta %q", text)
	}

	s.stream = func(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(string, string) error) error {
		return fmt.Errorf("status 500: boom")
	}
	rec = &eventRecorder{}
	s.Stream(context.Background(), &AIWriteJob{userID: 1}, rec.emit)
	if got := rec.names(); !slices.Equal(got, []string{AIWriteEventError}) || !strings.Contains(rec.events[0].data.(map[string]string)["message"], "boom") {
		t.Fatalf("error should be pushed: %+v", rec.events)
	}

	s.stream = func(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(string, string) error) error {
		return onChunk("  \n", "")
	}
	rec = &eventRecorder{}
	s.Stream(context.Background(), &AIWriteJob{userID: 1}, rec.emit)
	if got := rec.names(); !slices.Equal(got, []string{AIWriteEventError}) || rec.events[0].data.(map[string]string)["message"] != "ai_empty_response" {
		t.Fatalf("empty response should be an error: %+v", rec.events)
	}
}

// 同一用户发起新的生成时取消上一次；客户端断开（emit 失败）时取消上游调用
func TestAIWriteStreamCancel(t *testing.T) {
	started := make(chan struct{}, 2)
	s := newTestAIWriteService(func(ctx context.Context, cfg tools.AIConfig, system, user string, onChunk func(string, string) error) error {
		started <- struct{}{}
		if err := onChunk("片段", ""); err != nil {
			return err
		}
		<-ctx.Done()
		return ctx.Err()
	}, 2)

	first := &eventRecorder{}
	done := make(chan struct{})
	go func() {
		s.Stream(context.Background(), &AIWriteJob{userID: 7}, first.emit)
		close(done)
	}()
	<-started
	// 第二次生成取消第一次，第一次不再推送错误
	ctx, cancel := context.WithCancel(context.Background())
	second := &eventRecorder{}
	go s.Stream(ctx, &AIWriteJob{userID: 7}, second.emit)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("previous stream should be cancelled")
	}
	if got := first.names(); !slices.Equal(got, []string{AIWriteEventDelta}) {
		t.Fatalf("superseded stream events: %v", got)
	}
	<-started
	cancel()

	// emit 失败时立即结束
	s2 := newTestAIWriteService(s.stream, 1)
	returned := make(chan struct{})
	go func() {
		s2.Stream(context.Background(), &AIWriteJob{userID: 8}, func(string, any) error { return fmt.Errorf("broken pipe") })
		close(returned)
	}()
	<-started
	select {
	case <-returned:
	case <-time.After(2 * time.Second):
		t.Fatal("stream should stop when client is gone")
	}
}

// AI 写作与摘要共用并发限制：写作优先拿到释放的名额，排队时推送 queued
func TestAILimiterPriority(t *testing.T) {
	l := &aiLimiter{}
	limit := func() int { return 1 }
	if err := l.acquire(context.Background(), limit, false, nil); err != nil {
		t.Fatal(err)
	}
	order := make(chan string, 2)
	go func() {
		_ = l.acquire(context.Background(), limit, false, nil)
		order <- "summary"
		l.release()
	}()
	time.Sleep(20 * time.Millisecond)
	queued := make(chan struct{})
	go func() {
		_ = l.acquire(context.Background(), limit, true, func() { close(queued) })
		order <- "write"
		time.Sleep(10 * time.Millisecond)
		l.release()
	}()
	<-queued
	l.release()
	if first := <-order; first != "write" {
		t.Fatalf("priority request should acquire first, got %s", first)
	}
	if second := <-order; second != "summary" {
		t.Fatalf("summary should acquire after write, got %s", second)
	}

	// 等待中的优先请求取消后，普通请求可以继续获取
	if err := l.acquire(context.Background(), limit, false, nil); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	waitErr := make(chan error)
	go func() { waitErr <- l.acquire(ctx, limit, true, nil) }()
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-waitErr; err == nil {
		t.Fatal("cancelled acquire should return error")
	}
	l.release()
	got := make(chan struct{})
	go func() {
		_ = l.acquire(context.Background(), limit, false, nil)
		close(got)
	}()
	select {
	case <-got:
	case <-time.After(time.Second):
		t.Fatal("normal acquire should not be blocked by cancelled priority waiter")
	}
}
