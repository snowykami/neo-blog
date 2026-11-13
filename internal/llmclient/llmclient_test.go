package llmclient

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func TestLimiterPriorityAndSharedSlots(t *testing.T) {
	sharedstate.UseMemory()
	t.Cleanup(sharedstate.UseMemory)

	l := &Limiter{}
	one := func() int { return 1 }
	if err := l.Acquire(context.Background(), one, false, nil); err != nil {
		t.Fatal(err)
	}
	order := make(chan string, 2)
	go func() {
		_ = l.Acquire(context.Background(), one, false, nil)
		order <- "bg"
		l.Release()
	}()
	time.Sleep(20 * time.Millisecond)
	queued := make(chan struct{})
	go func() {
		_ = l.Acquire(context.Background(), one, true, func() { close(queued) })
		order <- "priority"
		time.Sleep(10 * time.Millisecond)
		l.Release()
	}()
	<-queued
	l.Release()
	if first := <-order; first != "priority" {
		t.Fatalf("priority request should acquire first, got %s", first)
	}
	if second := <-order; second != "bg" {
		t.Fatalf("background request should acquire second, got %s", second)
	}
}

func TestChatCompletionReasoningEffortFallback(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["reasoning_effort"]; ok {
			http.Error(w, "unsupported reasoning_effort", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"choices":[{"message":{"content":"hello"}}],"usage":{"prompt_tokens":12,"completion_tokens":5}}`)
	}))
	defer srv.Close()

	cfg := tools.AIConfig{BaseURL: srv.URL, APIKey: "sk-test", Model: "test-reasoning-fallback"}
	data, err := ChatCompletionRawCall(context.Background(), cfg, "sys", "usr", nil, 0.3, "low")
	if err != nil {
		t.Fatalf("first call failed: %v", err)
	}
	content, err := ParseChatCompletion(data)
	if err != nil || content != "hello" {
		t.Fatalf("got %q, %v", content, err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected 2 HTTP calls (initial + retry without reasoning_effort), got %d", calls.Load())
	}
	u := ParseUsageDetail(data)
	if u.Prompt != 12 || u.Completion != 5 {
		t.Fatalf("unexpected usage: %+v", u)
	}

	// 第二次调用记住不支持，直接不传 reasoning_effort，仅 1 次请求
	if _, err := ChatCompletionRawCall(context.Background(), cfg, "sys", "usr", nil, 0.3, "low"); err != nil {
		t.Fatalf("second call failed: %v", err)
	}
	if calls.Load() != 3 {
		t.Fatalf("expected 3 total calls, got %d", calls.Load())
	}
}

func TestChatCompletionStreamOptionsFallback(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["stream_options"]; ok {
			http.Error(w, "unsupported stream_options", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"think\"}}]}\n\n")
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n\n")
		_, _ = fmt.Fprint(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":3}}\n\n")
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	cfg := tools.AIConfig{BaseURL: srv.URL, APIKey: "sk-test", Model: "test-stream-fallback"}
	var gotContent, gotReasoning string
	usage, err := ChatCompletionStreamCall(context.Background(), cfg, "sys", "usr", func(c, r string) error {
		gotContent += c
		gotReasoning += r
		return nil
	})
	if err != nil {
		t.Fatalf("stream call failed: %v", err)
	}
	if gotContent != "world" || gotReasoning != "think" {
		t.Fatalf("got content=%q reasoning=%q", gotContent, gotReasoning)
	}
	if usage.Prompt != 10 || usage.Completion != 3 {
		t.Fatalf("unexpected stream usage: %+v", usage)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected 2 HTTP calls, got %d", calls.Load())
	}
}
