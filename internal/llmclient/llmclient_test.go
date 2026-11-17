package llmclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestLimiterFirstScreenPreemptsBackground(t *testing.T) {
	limiter := Limiter{Name: "test_tier_" + t.Name()}
	limit := func() int { return 1 }

	// 占满唯一的名额，让首屏与后台同时进入等待队列
	if err := limiter.AcquireTier(context.Background(), limit, TierBackground, nil); err != nil {
		t.Fatalf("initial acquire: %v", err)
	}

	bgWaiting := make(chan struct{})
	fsWaiting := make(chan struct{})
	order := make(chan string, 2)

	go func() {
		if err := limiter.AcquireTier(context.Background(), limit, TierBackground, func() { close(bgWaiting) }); err != nil {
			t.Errorf("bg acquire: %v", err)
			return
		}
		order <- "background"
		limiter.Release()
	}()
	<-bgWaiting

	go func() {
		if err := limiter.AcquireTier(context.Background(), limit, TierFirstScreen, func() { close(fsWaiting) }); err != nil {
			t.Errorf("first-screen acquire: %v", err)
			return
		}
		order <- "first-screen"
		limiter.Release()
	}()
	<-fsWaiting

	limiter.Release()

	if first := <-order; first != "first-screen" {
		t.Fatalf("expected first-screen to preempt background, got %q first", first)
	}
	if second := <-order; second != "background" {
		t.Fatalf("expected background second, got %q", second)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestChatCompletionReasoningPerEffortAndDeepSeek(t *testing.T) {
	// 1. 验证 per-effort 400 降级隔离："none" 被拒不应影响同一 (BaseURL, Model) 的 "high"
	var seenEfforts []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		effort, _ := body["reasoning_effort"].(string)
		seenEfforts = append(seenEfforts, effort)
		if effort == "none" {
			http.Error(w, "reasoning_effort=none is unsupported", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":4,"completion_tokens":2}}`)
	}))
	defer srv.Close()

	cfgIsolation := tools.AIConfig{BaseURL: srv.URL, APIKey: "sk-test", Model: "model-effort-isolation"}
	noneKey := modelEndpointKey(cfgIsolation.BaseURL, cfgIsolation.Model) + "\x00none"
	highKey := modelEndpointKey(cfgIsolation.BaseURL, cfgIsolation.Model) + "\x00high"
	t.Cleanup(func() {
		reasoningEffortUnsupported.Delete(noneKey)
		reasoningEffortUnsupported.Delete(highKey)
	})

	data, err := ChatCompletionRawCall(context.Background(), cfgIsolation, "sys", "usr", nil, 0.2, "none")
	if err != nil {
		t.Fatalf("call with none failed: %v", err)
	}
	if content, err := ParseChatCompletion(data); err != nil || content != "ok" {
		t.Fatalf("got %q, %v", content, err)
	}
	if _, err := ChatCompletionRawCall(context.Background(), cfgIsolation, "sys", "usr", nil, 0.2, "high"); err != nil {
		t.Fatalf("call with high failed: %v", err)
	}
	wantEfforts := []string{"none", "", "high"}
	if fmt.Sprint(seenEfforts) != fmt.Sprint(wantEfforts) {
		t.Fatalf("seen efforts = %v, want %v", seenEfforts, wantEfforts)
	}

	// 2. 验证 DeepSeek 官方接口将 effort 映射为 thinking:{type:disabled|enabled} 且支持 400 自动去参降级
	origClient := defaultHTTPClient
	t.Cleanup(func() {
		defaultHTTPClient = origClient
		reasoningEffortUnsupported.Delete(modelEndpointKey("https://api.deepseek.com/v1", "deepseek-chat") + "\x00none")
		reasoningEffortUnsupported.Delete(modelEndpointKey("https://api.deepseek.com/v1", "deepseek-chat") + "\x00high")
		reasoningEffortUnsupported.Delete(modelEndpointKey("https://api.deepseek.com/v1", "deepseek-legacy") + "\x00high")
	})

	type dsReqLog struct {
		url          string
		model        string
		hasReasoning bool
		hasThinking  bool
		thinkingType string
	}
	var dsLogs []dsReqLog
	defaultHTTPClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			rawBody, _ := io.ReadAll(req.Body)
			var payload map[string]any
			_ = json.Unmarshal(rawBody, &payload)

			modelName, _ := payload["model"].(string)
			_, hasReasoning := payload["reasoning_effort"]
			thinkingMap, hasThinking := payload["thinking"].(map[string]any)
			thinkingType, _ := thinkingMap["type"].(string)
			dsLogs = append(dsLogs, dsReqLog{
				url:          req.URL.String(),
				model:        modelName,
				hasReasoning: hasReasoning,
				hasThinking:  hasThinking,
				thinkingType: thinkingType,
			})

			if modelName == "deepseek-legacy" && hasThinking {
				return &http.Response{
					StatusCode: http.StatusBadRequest,
					Header:     http.Header{"Content-Type": []string{"text/plain"}},
					Body:       io.NopCloser(strings.NewReader("unknown field: thinking")),
				}, nil
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewBufferString(`{"choices":[{"message":{"content":"ds-ok"}}],"usage":{"prompt_tokens":5,"completion_tokens":3}}`)),
			}, nil
		}),
	}

	cfgDS := tools.AIConfig{BaseURL: "https://api.deepseek.com/v1", APIKey: "sk-ds", Model: "deepseek-chat"}
	if _, err := ChatCompletionRawCall(context.Background(), cfgDS, "sys", "usr", nil, 0.2, "none"); err != nil {
		t.Fatalf("deepseek none failed: %v", err)
	}
	if _, err := ChatCompletionRawCall(context.Background(), cfgDS, "sys", "usr", nil, 0.2, "high"); err != nil {
		t.Fatalf("deepseek high failed: %v", err)
	}
	cfgDSLegacy := tools.AIConfig{BaseURL: "https://api.deepseek.com/v1", APIKey: "sk-ds", Model: "deepseek-legacy"}
	if _, err := ChatCompletionRawCall(context.Background(), cfgDSLegacy, "sys", "usr", nil, 0.2, "high"); err != nil {
		t.Fatalf("deepseek legacy first call failed: %v", err)
	}
	if _, err := ChatCompletionRawCall(context.Background(), cfgDSLegacy, "sys", "usr", nil, 0.2, "high"); err != nil {
		t.Fatalf("deepseek legacy second call failed: %v", err)
	}

	if len(dsLogs) != 5 {
		t.Fatalf("expected 5 deepseek calls, got %d: %+v", len(dsLogs), dsLogs)
	}
	if dsLogs[0].hasReasoning || !dsLogs[0].hasThinking || dsLogs[0].thinkingType != "disabled" {
		t.Fatalf("deepseek none log unexpected: %+v", dsLogs[0])
	}
	if dsLogs[1].hasReasoning || !dsLogs[1].hasThinking || dsLogs[1].thinkingType != "enabled" {
		t.Fatalf("deepseek high log unexpected: %+v", dsLogs[1])
	}
	if !dsLogs[2].hasThinking || dsLogs[3].hasThinking || dsLogs[4].hasThinking {
		t.Fatalf("deepseek legacy fallback logs unexpected: %+v", dsLogs[2:])
	}
}

func TestChatCompletionStreamCallWithEffortAndFallback(t *testing.T) {
	// A: stream_options 返回 400（错误信息带 stream_options），应只剥离 stream_options 且保留 reasoning_effort
	type streamReq struct {
		effort        string
		streamOptions bool
	}
	var reqsA []streamReq
	srvA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		effort, _ := body["reasoning_effort"].(string)
		_, hasSO := body["stream_options"]
		reqsA = append(reqsA, streamReq{effort: effort, streamOptions: hasSO})
		if hasSO {
			http.Error(w, "unsupported parameter: stream_options", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"plan\"}}]}\n\n")
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"body\"}}]}\n\n")
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srvA.Close()

	cfgA := tools.AIConfig{BaseURL: srvA.URL, APIKey: "sk-test", Model: "stream-so-reject"}
	t.Cleanup(func() {
		streamUsageUnsupported.Delete(modelEndpointKey(cfgA.BaseURL, cfgA.Model))
		reasoningEffortUnsupported.Delete(modelEndpointKey(cfgA.BaseURL, cfgA.Model) + "\x00medium")
	})

	var gotContent, gotReasoning string
	_, err := ChatCompletionStreamCallWithEffort(context.Background(), cfgA, "sys", "usr", "medium", func(c, r string) error {
		gotContent += c
		gotReasoning += r
		return nil
	})
	if err != nil {
		t.Fatalf("stream A first call failed: %v", err)
	}
	if gotContent != "body" || gotReasoning != "plan" {
		t.Fatalf("stream A content=%q reasoning=%q", gotContent, gotReasoning)
	}
	if _, err := ChatCompletionStreamCallWithEffort(context.Background(), cfgA, "sys", "usr", "medium", func(c, r string) error { return nil }); err != nil {
		t.Fatalf("stream A second call failed: %v", err)
	}
	wantA := []streamReq{
		{effort: "medium", streamOptions: true},
		{effort: "medium", streamOptions: false},
		{effort: "medium", streamOptions: false},
	}
	if fmt.Sprint(reqsA) != fmt.Sprint(wantA) {
		t.Fatalf("stream A reqs = %+v, want %+v", reqsA, wantA)
	}

	// B: reasoning_effort 返回 400（错误信息不含 stream_options），应降级并缓存 effort 不支持且保留 stream_options
	var reqsB []streamReq
	srvB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		effort, _ := body["reasoning_effort"].(string)
		_, hasSO := body["stream_options"]
		reqsB = append(reqsB, streamReq{effort: effort, streamOptions: hasSO})
		if effort != "" {
			http.Error(w, "unknown field: reasoning_effort", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok-b\"}}]}\n\n")
		_, _ = fmt.Fprint(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":6,\"completion_tokens\":2}}\n\n")
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srvB.Close()

	cfgB := tools.AIConfig{BaseURL: srvB.URL, APIKey: "sk-test", Model: "stream-effort-reject"}
	t.Cleanup(func() {
		streamUsageUnsupported.Delete(modelEndpointKey(cfgB.BaseURL, cfgB.Model))
		reasoningEffortUnsupported.Delete(modelEndpointKey(cfgB.BaseURL, cfgB.Model) + "\x00high")
	})

	var contentB string
	usageB, err := ChatCompletionStreamCallWithEffort(context.Background(), cfgB, "sys", "usr", "high", func(c, _ string) error {
		contentB += c
		return nil
	})
	if err != nil {
		t.Fatalf("stream B first call failed: %v", err)
	}
	if contentB != "ok-b" || usageB.Prompt != 6 || usageB.Completion != 2 {
		t.Fatalf("stream B content=%q usage=%+v", contentB, usageB)
	}
	if _, err := ChatCompletionStreamCallWithEffort(context.Background(), cfgB, "sys", "usr", "high", func(_, _ string) error { return nil }); err != nil {
		t.Fatalf("stream B second call failed: %v", err)
	}
	wantB := []streamReq{
		{effort: "high", streamOptions: true},
		{effort: "", streamOptions: true},
		{effort: "", streamOptions: true},
	}
	if fmt.Sprint(reqsB) != fmt.Sprint(wantB) {
		t.Fatalf("stream B reqs = %+v, want %+v", reqsB, wantB)
	}
}

func TestLimiterHighConcurrencyAndQueuedCount(t *testing.T) {
	sharedstate.UseMemory()
	t.Cleanup(sharedstate.UseMemory)

	limiter := &Limiter{Name: "test_100_" + t.Name()}
	hundred := func() int { return 100 }
	baseQueued := QueuedTasks()

	// 上限 100 时公共名额为 1..99（共 99 个），第 0 个名额留给交互式请求
	for i := range 99 {
		if err := limiter.AcquireTier(context.Background(), hundred, TierFirstScreen, nil); err != nil {
			t.Fatalf("acquire general slot %d: %v", i, err)
		}
	}
	// 交互式请求仍可立即拿到预留的 0 号名额（共 100 个并发）
	if err := limiter.AcquireTier(context.Background(), hundred, TierInteractive, nil); err != nil {
		t.Fatalf("acquire reserved interactive slot: %v", err)
	}

	// 再来两个任务应进入排队计数，取消或释放后排队计数恢复
	ctx1, cancel1 := context.WithCancel(context.Background())
	defer cancel1()
	waiting1 := make(chan struct{})
	done1 := make(chan error, 1)
	go func() {
		done1 <- limiter.AcquireTier(ctx1, hundred, TierFirstScreen, func() { close(waiting1) })
	}()
	<-waiting1

	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	waiting2 := make(chan struct{})
	done2 := make(chan error, 1)
	go func() {
		done2 <- limiter.AcquireTier(ctx2, hundred, TierBackground, func() { close(waiting2) })
	}()
	<-waiting2

	if got := QueuedTasks() - baseQueued; got != 2 {
		t.Fatalf("queued tasks = %d, want 2", got)
	}

	cancel2()
	<-done2
	if got := QueuedTasks() - baseQueued; got != 1 {
		t.Fatalf("queued tasks after cancel = %d, want 1", got)
	}

	limiter.Release()
	if err := <-done1; err != nil {
		t.Fatalf("waiting1 acquire after release: %v", err)
	}
	if got := QueuedTasks() - baseQueued; got != 0 {
		t.Fatalf("queued tasks after acquire = %d, want 0", got)
	}

	for range 100 {
		limiter.Release()
	}
}
