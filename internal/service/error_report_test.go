package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// envelope 按 SDK 的格式拼一个信封：信封头一行，之后每个条目为条目头与内容
func envelope(t *testing.T, items ...any) []byte {
	t.Helper()
	lines := []string{`{"event_id":"0123456789abcdef0123456789abcdef","sent_at":"2026-11-06T12:00:00Z"}`}
	for _, item := range items {
		payload, err := json.Marshal(item)
		if err != nil {
			t.Fatal(err)
		}
		typ := "event"
		if m, ok := item.(map[string]any); ok && m["__type"] != nil {
			typ = m["__type"].(string)
		}
		lines = append(lines, fmt.Sprintf(`{"type":%q,"length":%d}`, typ, len(payload)), string(payload))
	}
	return []byte(strings.Join(lines, "\n") + "\n")
}

func browserError(eventID, message, function string) map[string]any {
	return map[string]any{
		"event_id":  eventID,
		"level":     "error",
		"platform":  "javascript",
		"release":   "abc123",
		"timestamp": 1793963000.5,
		"exception": map[string]any{"values": []any{map[string]any{
			"type":  "TypeError",
			"value": message,
			"stacktrace": map[string]any{"frames": []any{
				map[string]any{"filename": "node_modules/react-dom/client.js", "function": "commitRoot", "lineno": 10, "in_app": false},
				map[string]any{"filename": "src/lib/lyrics/lyric-player.ts", "function": function, "lineno": 120, "colno": 5, "in_app": true, "context_line": "    view.el.style.transform = transform"},
			}},
		}}},
		"breadcrumbs": []any{map[string]any{"category": "navigation", "data": map[string]any{"to": "/music"}}},
		"contexts":    map[string]any{"signals": map[string]any{"screen": "390x844"}, "page": map[string]any{"visibility": "visible"}},
		"tags":        map[string]any{"locale": "zh"},
		"request":     map[string]any{"url": "https://blog.example.com/p/hello?token=secret", "headers": map[string]any{"User-Agent": testChromeUA}},
	}
}

func TestParseSentryEnvelope(t *testing.T) {
	// 带 length 的条目按字节数读取（内容里可以有换行）；没有 length 的读到行尾；非 event 条目忽略
	body := envelope(t, browserError("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "x is undefined", "paint"), map[string]any{"__type": "client_report", "discarded_events": []any{}})
	body = append(body, []byte("{\"type\":\"event\"}\n{\"event_id\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"message\":\"hello\"}\n")...)
	events, err := parseSentryEnvelope(body)
	if err != nil || len(events) != 2 {
		t.Fatalf("events=%d err=%v", len(events), err)
	}
	if events[0].exceptions()[0].Value != "x is undefined" || events[1].message() != "hello" {
		t.Fatalf("parsed: %+v / %q", events[0].exceptions(), events[1].message())
	}
	for _, bad := range []string{"", "not json\n", "{}\n{\"type\":\"event\",\"length\":999}\n{}"} {
		if _, err := parseSentryEnvelope([]byte(bad)); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

func TestErrorFingerprint(t *testing.T) {
	a := reportFromSentry(mustEvent(t, browserError("", "Cannot read properties of undefined (reading 'x') at 123", "paint")), testChromeUA, time.Now())
	b := reportFromSentry(mustEvent(t, browserError("", "Cannot read properties of undefined (reading 'x') at 456", "paint")), testChromeUA, time.Now())
	c := reportFromSentry(mustEvent(t, browserError("", "Cannot read properties of undefined (reading 'x') at 456", "layout")), testChromeUA, time.Now())
	// 消息里的数字不影响聚合；出错的站内函数不同时分开
	if errorFingerprint(a) != errorFingerprint(b) || errorFingerprint(b) == errorFingerprint(c) {
		t.Fatal("fingerprint grouping is wrong")
	}
	if got := errorCulprit(a); got != "paint (src/lib/lyrics/lyric-player.ts:120)" {
		t.Fatalf("culprit = %q", got)
	}
	if a.Path != "/p/hello" || a.Source != constant.ErrorSourceBrowser || a.Kind != constant.ErrorKindError {
		t.Fatalf("report: %+v", a)
	}
	// 页面崩溃按栏目聚合
	crash := map[string]any{"message": "Page crashed", "level": "fatal", "tags": map[string]any{"kind": "crash"}, "request": map[string]any{"url": "https://blog.example.com/p/a"}}
	crash2 := map[string]any{"message": "Page crashed", "level": "fatal", "tags": map[string]any{"kind": "crash"}, "request": map[string]any{"url": "https://blog.example.com/p/b"}}
	r1, r2 := reportFromSentry(mustEvent(t, crash), "", time.Now()), reportFromSentry(mustEvent(t, crash2), "", time.Now())
	if r1.Kind != constant.ErrorKindCrash || r1.Level != "fatal" || errorFingerprint(r1) != errorFingerprint(r2) {
		t.Fatalf("crash report: %+v", r1)
	}
	// Next 服务端以 node 平台上报
	server := reportFromSentry(mustEvent(t, map[string]any{"platform": "node", "message": "boom"}), "", time.Now())
	if server.Source != constant.ErrorSourceServer {
		t.Fatalf("server source = %q", server.Source)
	}
}

func TestIngestErrorEnvelope(t *testing.T) {
	_, admin, _, _, _ := setupEditTest(t)
	svc := NewErrorReportService()
	client := ErrorReportClient{IP: testIP, UserAgent: testChromeUA}

	// 1. 同一问题聚合计数，事件保存现场；地址中的查询参数去掉
	for i := 0; i < 3; i++ {
		id := fmt.Sprintf("%032x", i+1)
		if svcerr := svc.IngestEnvelope(admin, envelope(t, browserError(id, fmt.Sprintf("bad value %d", i), "paint")), client); svcerr != nil {
			t.Fatalf("ingest: %v", svcerr)
		}
	}
	issues, total, svcerr := svc.ListIssues(context.Background(), &dto.ListErrorIssuesReq{})
	if svcerr != nil || total != 1 || issues[0].Count != 3 || issues[0].Status != constant.ErrorStatusUnresolved || issues[0].LastRelease != "abc123" {
		t.Fatalf("issues: total=%d %+v err=%v", total, issues, svcerr)
	}
	events, _, _ := svc.ListEvents(context.Background(), issues[0].ID, &dto.ListErrorEventsReq{})
	if len(events) != 3 || events[0].Browser != "Chrome" || events[0].Path != "/p/hello" {
		t.Fatalf("events: %+v", events)
	}
	event, svcerr := svc.GetEvent(context.Background(), events[0].ID)
	if svcerr != nil || event.User == nil || event.Detail["request"].(map[string]any)["url"] != "https://blog.example.com/p/hello" {
		t.Fatalf("event: %+v err=%v", event, svcerr)
	}
	if _, ok := event.Detail["contexts"].(map[string]any)["signals"]; !ok {
		t.Fatal("signals should be kept without DNT")
	}
	// 按事件 ID 查找问题
	if found, total, _ := svc.ListIssues(context.Background(), &dto.ListErrorIssuesReq{Query: fmt.Sprintf("%032x", 2)}); total != 1 || found[0].ID != issues[0].ID {
		t.Fatalf("lookup by event id: total=%d", total)
	}

	// 2. 请勿追踪：不关联用户，不保存设备信号
	dnt := client
	dnt.DoNotTrack = true
	if svcerr := svc.IngestEnvelope(admin, envelope(t, browserError(fmt.Sprintf("%032x", 99), "other problem", "layout")), dnt); svcerr != nil {
		t.Fatal(svcerr)
	}
	var anon model.ErrorEvent
	repo.GetDB().Where("event_id = ?", fmt.Sprintf("%032x", 99)).First(&anon)
	if !anon.Anonymous || anon.UserID != nil || anon.VisitorID != nil {
		t.Fatalf("dnt event: %+v", anon)
	}
	if contexts, _ := anon.Detail["contexts"].(map[string]any); contexts["signals"] != nil || contexts["page"] == nil {
		t.Fatalf("dnt contexts: %+v", contexts)
	}

	// 3. 每个问题每小时只保存有限条现场，次数照常累计
	for i := 0; i < errorEventsPerIssuePerHour+5; i++ {
		_ = svc.IngestEnvelope(admin, envelope(t, browserError("", "flood", "flood")), ErrorReportClient{IP: fmt.Sprintf("10.0.0.%d", i), UserAgent: testChromeUA})
	}
	var flood model.ErrorIssue
	repo.GetDB().Where("title = ?", "TypeError: flood").First(&flood)
	var stored int64
	repo.GetDB().Model(&model.ErrorEvent{}).Where("issue_id = ?", flood.ID).Count(&stored)
	if flood.Count != int64(errorEventsPerIssuePerHour+5) || stored != errorEventsPerIssuePerHour {
		t.Fatalf("flood: count=%d stored=%d", flood.Count, stored)
	}

	// 4. 同一 IP 上报过于频繁时拒绝
	limited := ErrorReportClient{IP: "10.9.9.9", UserAgent: testChromeUA}
	var lastErr error
	for i := 0; i <= errorReportRateLimit; i++ {
		if svcerr := svc.IngestEnvelope(admin, envelope(t, browserError("", "rate", "rate")), limited); svcerr != nil {
			lastErr = svcerr
		}
	}
	if lastErr == nil {
		t.Fatal("rate limit not applied")
	}

	// 5. 已解决的问题再次出现时回到未处理
	if svcerr := svc.UpdateIssueStatus(context.Background(), issues[0].ID, &dto.UpdateErrorIssueReq{Status: constant.ErrorStatusResolved}); svcerr != nil {
		t.Fatal(svcerr)
	}
	_ = svc.IngestEnvelope(admin, envelope(t, browserError("", "bad value 7", "paint")), ErrorReportClient{IP: "10.1.1.1", UserAgent: testChromeUA})
	reopened, _ := svc.GetIssue(context.Background(), issues[0].ID)
	if reopened.Status != constant.ErrorStatusUnresolved || reopened.ResolvedAt != nil || reopened.Count != 4 {
		t.Fatalf("reopened: %+v", reopened.ErrorIssueDto)
	}

	// 6. 爬虫的上报忽略
	before := countIssues(t)
	_ = svc.IngestEnvelope(admin, envelope(t, browserError("", "bot only", "bot")), ErrorReportClient{IP: "10.2.2.2", UserAgent: "Googlebot/2.1"})
	if countIssues(t) != before {
		t.Fatal("bot report should be ignored")
	}
}

func TestRecordBackendError(t *testing.T) {
	setupEditTest(t)
	svc := NewErrorReportService()
	// Hertz recovery 的调用栈格式：每帧「文件:行号 (pc)」与「\t函数: 源码」，从 panic 发生处开始
	stack := "/app/internal/service/post.go:42 (0x1053f416b)\n\t(*PostService).GetPost: return list[3]\n" +
		"/root/go/pkg/mod/github.com/cloudwego/hertz@v0.10.6/pkg/app/context.go:827 (0x104b8315f)\n\t(*RequestContext).Next: ctx.handlers[ctx.index](c, ctx)\n"
	svc.RecordBackendError(context.Background(), BackendError{Panic: true, Status: 500, Cause: "runtime error: index out of range [3] with length 3", Stack: []byte(stack), Method: "GET", Path: "/api/v1/post/p/42"})
	svc.RecordBackendError(context.Background(), BackendError{Status: 500, Code: "failed_to_get_target", Cause: "database is locked", Method: "GET", Path: "/api/v1/post/p/43"})
	issues, total, _ := svc.ListIssues(context.Background(), &dto.ListErrorIssuesReq{Source: constant.ErrorSourceBackend})
	if total != 2 {
		t.Fatalf("backend issues = %d", total)
	}
	var panicIssue *dto.ErrorIssueDto
	for _, issue := range issues {
		if issue.Level == "fatal" {
			panicIssue = issue
		}
	}
	if panicIssue == nil || panicIssue.Culprit != "GET /api/v1/post/p/42 · internal/service/post.go:42 (*PostService).GetPost" || !strings.HasPrefix(panicIssue.Title, "panic: runtime error") {
		t.Fatalf("panic issue: %+v", panicIssue)
	}
}

func mustEvent(t *testing.T, raw map[string]any) *sentryEvent {
	t.Helper()
	b, _ := json.Marshal(raw)
	var event sentryEvent
	if err := json.Unmarshal(b, &event); err != nil {
		t.Fatal(err)
	}
	return &event
}

func countIssues(t *testing.T) int64 {
	t.Helper()
	var n int64
	repo.GetDB().Model(&model.ErrorIssue{}).Count(&n)
	return n
}

func TestFirstAppFunction(t *testing.T) {
	debugStack := "goroutine 1 [running]:\nruntime/debug.Stack()\n\t/usr/local/go/src/runtime/debug/stack.go:26 +0x5e\n" +
		"github.com/snowykami/neo-blog/internal/middleware.RecoveryHandler(...)\n\t/app/internal/middleware/error_report.go:20\n" +
		"github.com/snowykami/neo-blog/internal/service.(*PostService).GetPost(0x1)\n\t/app/internal/service/post.go:42 +0x1c\n"
	if got := firstAppFunction(debugStack); got != "internal/service/post.go:42 service.(*PostService).GetPost" {
		t.Fatalf("debug.Stack format: %q", got)
	}
	if got := firstAppFunction("/usr/local/go/src/runtime/panic.go:12 (0x1)\n\tgopanic: x\n"); got != "" {
		t.Fatalf("no app frame: %q", got)
	}
}

// 公开上报的量级上限：一次上报最多处理几条事件；每小时新建问题数有上限，已有问题照常累计；现场超出上限时丢次要字段
func TestErrorEnvelopeCaps(t *testing.T) {
	_, admin, _, _, _ := setupEditTest(t)
	svc := NewErrorReportService()
	client := ErrorReportClient{IP: "10.9.9.9", UserAgent: testChromeUA}

	items := make([]any, 0, errorEventsPerEnvelope+3)
	for i := 0; i < errorEventsPerEnvelope+3; i++ {
		items = append(items, browserError("", fmt.Sprintf("capped %d", i), fmt.Sprintf("capFn%d", i)))
	}
	if svcerr := svc.IngestEnvelope(admin, envelope(t, items...), client); svcerr != nil {
		t.Fatalf("ingest: %v", svcerr)
	}
	_, total, _ := svc.ListIssues(context.Background(), &dto.ListErrorIssuesReq{})
	if total != errorEventsPerEnvelope {
		t.Fatalf("issues after one envelope = %d, want %d", total, errorEventsPerEnvelope)
	}

	// 本小时新建问题的名额用完：新的指纹不再建问题，已有的问题照常累计
	key := fmt.Sprintf("error_report_new_issues:%d", time.Now().Truncate(time.Hour).Unix())
	for i := 0; i < errorNewIssuesPerHour; i++ {
		_, _ = sharedstate.Current().Incr(key, time.Hour)
	}
	_ = svc.IngestEnvelope(admin, envelope(t, browserError("", "brand new", "brandNewFn")), ErrorReportClient{IP: "10.9.9.10", UserAgent: testChromeUA})
	_ = svc.IngestEnvelope(admin, envelope(t, browserError("", "capped 0", "capFn0")), ErrorReportClient{IP: "10.9.9.11", UserAgent: testChromeUA})
	issues, total, _ := svc.ListIssues(context.Background(), &dto.ListErrorIssuesReq{})
	if total != errorEventsPerEnvelope {
		t.Fatalf("new issue should be dropped after the hourly cap, total = %d", total)
	}
	counted := false
	for _, issue := range issues {
		if issue.Count == 2 {
			counted = true
		}
	}
	if !counted {
		t.Fatal("existing issue should still be counted after the hourly cap")
	}

	// 现场过大时先丢自定义数据，异常保留
	detail := capErrorDetail(map[string]any{"exception": []string{"boom"}, "extra": strings.Repeat("x", 1000)}, 200)
	if _, ok := detail["extra"]; ok {
		t.Fatal("extra should be dropped when detail is too large")
	}
	if _, ok := detail["exception"]; !ok {
		t.Fatal("exception should be kept")
	}
}

// 后端错误按指纹限频：同一指纹在窗口内只写一次库，其余只累计次数，窗口过后并入下一次写库；不同指纹各写一次
func TestRecordBackendErrorThrottle(t *testing.T) {
	setupEditTest(t)
	svc := NewErrorReportService()
	dbDown := BackendError{Status: 500, Code: "failed_to_get_target", Cause: "dial tcp 10.0.0.5:5432: connection refused", Method: "GET", Path: "/api/v1/post/p/1"}
	for i := 0; i < 3; i++ {
		e := dbDown
		e.Path = fmt.Sprintf("/api/v1/post/p/%d", i) // 同一栏目、只有数字不同，指纹相同
		svc.RecordBackendError(context.Background(), e)
	}
	other := BackendError{Status: 500, Code: "failed_to_list_comments", Cause: "timeout", Method: "GET", Path: "/api/v1/comment/list"}
	svc.RecordBackendError(context.Background(), other)

	issues, total, _ := svc.ListIssues(context.Background(), &dto.ListErrorIssuesReq{Source: constant.ErrorSourceBackend})
	if total != 2 {
		t.Fatalf("backend issues = %d, want 2", total)
	}
	var throttled *dto.ErrorIssueDto
	for _, issue := range issues {
		if strings.HasPrefix(issue.Title, "failed_to_get_target") {
			throttled = issue
		} else if issue.Count != 1 {
			t.Fatalf("other issue count = %d", issue.Count)
		}
	}
	if throttled == nil || throttled.Count != 1 || countEvents(t, throttled.ID) != 1 {
		t.Fatalf("throttled issue should be written once: %+v", throttled)
	}

	// 窗口过后再出现：写库一次，并把窗口内只计数的 2 次并进去
	report := &errorReport{Source: constant.ErrorSourceBackend, Kind: constant.ErrorKindError, Type: dbDown.Code, Value: dbDown.Cause, Method: dbDown.Method, Path: dbDown.Path}
	if err := sharedstate.Current().Delete("error_report_backend_throttle:" + errorFingerprint(report)); err != nil {
		t.Fatal(err)
	}
	svc.RecordBackendError(context.Background(), dbDown)
	issue, _ := svc.GetIssue(context.Background(), throttled.ID)
	if issue.Count != 4 || countEvents(t, throttled.ID) != 2 {
		t.Fatalf("after window: count = %d, events = %d", issue.Count, countEvents(t, throttled.ID))
	}
}

// 后台写错误报告的协程数已满时直接丢弃，不再起新协程
func TestReportBackendErrorAsyncBounded(t *testing.T) {
	setupEditTest(t)
	for i := 0; i < backendErrorMaxWriters; i++ {
		backendErrorWriters <- struct{}{}
	}
	before, warnedBefore := backendErrorDropped.Load(), backendErrorDropWarnAt.Load()
	NewErrorReportService().ReportBackendErrorAsync(context.Background(), BackendError{Status: 500, Code: "dropped", Method: "GET", Path: "/x"})
	for i := 0; i < backendErrorMaxWriters; i++ {
		<-backendErrorWriters
	}
	// 丢弃时计数加一，或刚好输出了汇总告警（计数随之清零）
	if backendErrorDropped.Load() == before && backendErrorDropWarnAt.Load() == warnedBefore {
		t.Fatal("report should be dropped when writers are full")
	}
	if countIssues(t) != 0 {
		t.Fatal("dropped report should not be written")
	}
}

func countEvents(t *testing.T, issueID uint) int64 {
	t.Helper()
	var n int64
	repo.GetDB().Model(&model.ErrorEvent{}).Where("issue_id = ?", issueID).Count(&n)
	return n
}
