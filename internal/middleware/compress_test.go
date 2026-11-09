package middleware

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/config"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/cloudwego/hertz/pkg/route"
)

// 文本类大响应压缩；小响应、非文本内容、SSE 长连接与文件下载不压缩
func TestCompress(t *testing.T) {
	big := strings.Repeat(`{"id":1,"name":"夜に駆ける"},`, 100)
	engine := route.NewEngine(config.NewOptions(nil))
	engine.Use(UseCompress())
	reply := func(contentType, body string) app.HandlerFunc {
		return func(ctx context.Context, c *app.RequestContext) {
			c.Data(200, contentType, []byte(body))
		}
	}
	engine.GET("/api/v1/big", reply("application/json; charset=utf-8", big))
	engine.GET("/api/v1/small", reply("application/json; charset=utf-8", `{"status":200,"message":"success"}`))
	engine.GET("/api/v1/image", reply("image/png", big))
	engine.GET("/api/v1/notifications/stream", reply("text/event-stream; charset=utf-8", big))
	engine.GET("/api/v1/file/f/1/a.txt", reply("text/plain; charset=utf-8", big))

	gzipHeader := ut.Header{Key: "Accept-Encoding", Value: "gzip"}
	get := func(path string, headers ...ut.Header) *ut.ResponseRecorder {
		return ut.PerformRequest(engine, "GET", path, nil, headers...)
	}

	// 大 JSON：压缩，解压后与原文一致，并带上 Vary
	if w := get("/api/v1/big", gzipHeader); w.Header().Get("Content-Encoding") != "gzip" || w.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("big json encoding = %q, vary = %q", w.Header().Get("Content-Encoding"), w.Header().Get("Vary"))
	} else {
		reader, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
		if err != nil {
			t.Fatalf("new gzip reader: %v", err)
		}
		plain, err := io.ReadAll(reader)
		if err != nil {
			t.Fatalf("read gzip body: %v", err)
		}
		if string(plain) != big {
			t.Fatalf("big json decompressed length = %d, want %d", len(plain), len(big))
		}
	}

	// 客户端不支持 gzip 时原样返回
	if w := get("/api/v1/big"); w.Header().Get("Content-Encoding") != "" || w.Body.String() != big {
		t.Fatalf("big json without accept-encoding: encoding = %q, body = %q", w.Header().Get("Content-Encoding"), w.Body.String())
	}

	// 小响应压缩后反而更大，不压
	if w := get("/api/v1/small", gzipHeader); w.Header().Get("Content-Encoding") != "" ||
		w.Body.String() != `{"status":200,"message":"success"}` {
		t.Fatalf("small json: encoding = %q, body = %q", w.Header().Get("Content-Encoding"), w.Body.String())
	}

	// 图片、SSE 长连接、文件下载都原样返回
	for _, path := range []string{"/api/v1/image", "/api/v1/notifications/stream", "/api/v1/file/f/1/a.txt"} {
		if w := get(path, gzipHeader); w.Header().Get("Content-Encoding") != "" || w.Body.String() != big {
			t.Fatalf("%s: encoding = %q, body length = %d", path, w.Header().Get("Content-Encoding"), w.Body.Len())
		}
	}

	// 请求头声明只要事件流时（EventSource）不压缩
	if w := get("/api/v1/big", gzipHeader, ut.Header{Key: "Accept", Value: "text/event-stream"}); w.Header().Get("Content-Encoding") != "" {
		t.Fatalf("event stream accept: encoding = %q", w.Header().Get("Content-Encoding"))
	}
}
