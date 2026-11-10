package middleware

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"strconv"
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

// countingReader 记录被读了多少字节，用来确认压缩中间件没有把流式响应体读进内存
type countingReader struct {
	r    io.Reader
	read int
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.read += n
	return n, err
}

// 流式响应体、HEAD、Range 请求与 206 / Content-Range 响应都不压缩，也不读取流式响应体
func TestCompressSkipsStreamAndRange(t *testing.T) {
	big := strings.Repeat("<p>hello neo-blog</p>", 200)
	var stream *countingReader
	readBeforeWrite := -1
	engine := route.NewEngine(config.NewOptions(nil))
	// 外层探针：压缩中间件返回后、响应写出前，流式响应体应当一个字节都没被读过
	engine.Use(func(ctx context.Context, c *app.RequestContext) {
		c.Next(ctx)
		if stream != nil {
			readBeforeWrite = stream.read
			if !c.Response.IsBodyStream() {
				t.Errorf("body stream was consumed by compress middleware")
			}
		}
	}, UseCompress())
	engine.GET("/api/v1/page-html/1/video.html", func(ctx context.Context, c *app.RequestContext) {
		stream = &countingReader{r: strings.NewReader(big)}
		c.Response.Header.SetContentType("text/html; charset=utf-8")
		c.Response.SetBodyStream(stream, len(big))
	})
	engine.GET("/api/v1/big", func(ctx context.Context, c *app.RequestContext) {
		c.Data(200, "text/html; charset=utf-8", []byte(big))
	})
	engine.HEAD("/api/v1/big", func(ctx context.Context, c *app.RequestContext) {
		c.Data(200, "text/html; charset=utf-8", []byte(big))
	})
	engine.GET("/api/v1/partial", func(ctx context.Context, c *app.RequestContext) {
		c.Response.Header.Set("Content-Range", "bytes 0-"+strconv.Itoa(len(big)-1)+"/99999")
		c.Data(206, "text/html; charset=utf-8", []byte(big))
	})
	engine.GET("/api/v1/content-range", func(ctx context.Context, c *app.RequestContext) {
		c.Response.Header.Set("Content-Range", "bytes 0-"+strconv.Itoa(len(big)-1)+"/"+strconv.Itoa(len(big)))
		c.Data(200, "text/html; charset=utf-8", []byte(big))
	})

	gzipHeader := ut.Header{Key: "Accept-Encoding", Value: "gzip"}

	// 流式响应体：不压缩、不提前读取，写出时内容完整
	w := ut.PerformRequest(engine, "GET", "/api/v1/page-html/1/video.html", nil, gzipHeader)
	if readBeforeWrite != 0 {
		t.Fatalf("stream read %d bytes before response was written", readBeforeWrite)
	}
	if w.Header().Get("Content-Encoding") != "" || w.Body.String() != big {
		t.Fatalf("stream: encoding = %q, body length = %d", w.Header().Get("Content-Encoding"), w.Body.Len())
	}
	stream = nil

	// HEAD 请求不压缩
	if w := ut.PerformRequest(engine, "HEAD", "/api/v1/big", nil, gzipHeader); w.Header().Get("Content-Encoding") != "" {
		t.Fatalf("head: encoding = %q", w.Header().Get("Content-Encoding"))
	}

	// 带 Range 的请求不压缩
	if w := ut.PerformRequest(engine, "GET", "/api/v1/big", nil, gzipHeader, ut.Header{Key: "Range", Value: "bytes=0-"}); w.Header().Get("Content-Encoding") != "" || w.Body.String() != big {
		t.Fatalf("range request: encoding = %q, body length = %d", w.Header().Get("Content-Encoding"), w.Body.Len())
	}

	// 206 与带 Content-Range 的响应不压缩
	for _, path := range []string{"/api/v1/partial", "/api/v1/content-range"} {
		if w := ut.PerformRequest(engine, "GET", path, nil, gzipHeader); w.Header().Get("Content-Encoding") != "" || w.Body.String() != big {
			t.Fatalf("%s: encoding = %q, body length = %d", path, w.Header().Get("Content-Encoding"), w.Body.Len())
		}
	}

	// 对照：同样的内容在普通 GET 下仍然压缩
	if w := ut.PerformRequest(engine, "GET", "/api/v1/big", nil, gzipHeader); w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("big html: encoding = %q", w.Header().Get("Content-Encoding"))
	}
}
