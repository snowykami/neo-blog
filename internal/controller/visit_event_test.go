package v1

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/snowykami/neo-blog/internal/service"
)

func TestParsePlausibleEventsBoundaries(t *testing.T) {
	validSingle := []byte(`{"n":"pageview","u":"https://blog.example.com/p/1"}`)
	if events, ok := parsePlausibleEvents(validSingle); !ok || len(events) != 1 || events[0].Name != "pageview" {
		t.Fatalf("valid single failed: ok=%v events=%+v", ok, events)
	}

	validCaseWrapper := []byte(`{"Events":[{"n":"engagement","u":"https://blog.example.com/p/1","e":3000}]}`)
	if events, ok := parsePlausibleEvents(validCaseWrapper); !ok || len(events) != 1 || events[0].Name != "engagement" {
		t.Fatalf("case-insensitive wrapper failed: ok=%v events=%+v", ok, events)
	}

	invalidCases := map[string][]byte{
		"mixed_single_and_batch": []byte(`{"n":"pageview","u":"https://blog.example.com/a","events":[{"n":"engagement","u":"https://blog.example.com/b","e":1000}]}`),
		"mixed_single_and_null":  []byte(`{"n":"pageview","u":"https://blog.example.com/a","events":null}`),
		"null_events":            []byte(`{"events":null}`),
		"trailing_garbage":       []byte(`{"n":"pageview","u":"https://blog.example.com/a"}{"n":"pageview"}`),
		"trailing_array_garbage": []byte(`[{"n":"pageview","u":"https://blog.example.com/a"}]123`),
		"primitive_number":       []byte(`123`),
		"primitive_string":       []byte(`"hello"`),
		"primitive_null":         []byte(`null`),
	}
	for name, payload := range invalidCases {
		if events, ok := parsePlausibleEvents(payload); ok {
			t.Fatalf("case %s should fail, got %+v", name, events)
		}
	}
}

type trackingChunkReader struct {
	remaining int
	readBytes int
}

func (r *trackingChunkReader) Read(p []byte) (int, error) {
	if r.remaining <= 0 {
		return 0, io.EOF
	}
	n := min(len(p), r.remaining)
	for i := range n {
		p[i] = 'a'
	}
	r.remaining -= n
	r.readBytes += n
	return n, nil
}

func TestVisitEventStreamBodyBoundedRead(t *testing.T) {
	// 1. 直接验证服务端流式读取器精确在 maxEventBatchBodySize+1 字节处停止，绝不将后续数 MB 读入 Go 堆内存
	serverStream := &trackingChunkReader{remaining: 4 << 20}
	ctx := app.NewContext(0)
	ctx.Request.SetBodyStream(serverStream, -1)
	if buf, ok := readBoundedBody(ctx, maxEventBatchBodySize); ok || buf != nil {
		t.Fatalf("expected oversized stream to be rejected")
	}
	if serverStream.readBytes != maxEventBatchBodySize+1 {
		t.Fatalf("server readBytes = %d, want exact %d", serverStream.readBytes, maxEventBatchBodySize+1)
	}
	if !ctx.Response.ConnectionClose() {
		t.Fatalf("expected Connection: close on rejected oversized stream")
	}

	// 2. 在真实 Hertz WithStreamBody(true) HTTP 服务下验证超大 chunked 流式请求返回 400、合法小包正常解析
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()

	h := server.New(
		server.WithHostPorts(addr),
		server.WithStreamBody(true),
		server.WithMaxRequestBodySize(10<<20),
		server.WithExitWaitTime(0),
	)
	h.POST("/event", func(reqCtx context.Context, c *app.RequestContext) {
		Visit.Event(reqCtx, c)
	})
	go func() { _ = h.Run() }()
	t.Cleanup(func() { _ = h.Shutdown(context.Background()) })
	for range 50 {
		if conn, err := net.Dial("tcp", addr); err == nil {
			_ = conn.Close()
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	stream := &trackingChunkReader{remaining: 2 << 20}
	req, err := http.NewRequest(http.MethodPost, "http://"+addr+"/event", io.NopCloser(stream))
	if err != nil {
		t.Fatal(err)
	}
	req.ContentLength = -1
	req.Header.Set("Content-Type", "text/plain")

	resp, err := http.DefaultClient.Do(req)
	if err != nil && !strings.Contains(err.Error(), "EOF") && !strings.Contains(err.Error(), "reset") && !strings.Contains(err.Error(), "broken pipe") {
		t.Fatalf("unexpected request error: %v", err)
	}
	if resp != nil {
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for oversized streamed body, got %d", resp.StatusCode)
		}
	}

	// 合法尺寸的 chunked 流式请求正常解析进入业务校验（非法路径返回业务层 400 而非流截断）
	smallChunk := bytes.NewBufferString(`{"events":[{"n":"engagement","u":"invalid-relative-url","e":1000}]}`)
	smallReq, _ := http.NewRequest(http.MethodPost, "http://"+addr+"/event", io.NopCloser(smallChunk))
	smallReq.ContentLength = -1
	smallResp, err := http.DefaultClient.Do(smallReq)
	if err != nil {
		t.Fatalf("small streamed request failed: %v", err)
	}
	_ = smallResp.Body.Close()
	if smallResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 on invalid URL, got %d (max items=%d)", smallResp.StatusCode, service.MaxEventBatchItems)
	}
}
