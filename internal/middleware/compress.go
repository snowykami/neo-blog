package middleware

import (
	"compress/flate"
	"context"
	"mime"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	hertzcompress "github.com/cloudwego/hertz/pkg/common/compress"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/cloudwego/hertz/pkg/protocol/consts"
)

// 响应压缩（gzip）：只压文本类的大响应，用最快级别
//
// 歌单是一次上千首、几百 KB 的 JSON，压完只剩 8% 左右。900 首、326 KB 实测：
// BestSpeed 压到 29 KB / 0.37ms，默认级别压到 25 KB / 1.2ms——体积只差 18%，CPU 却是 3 倍，
// 而歌单是并发最高的大响应，所以这里用 BestSpeed。
//
// 不压缩的情况：
//   - 客户端没有声明支持 gzip
//   - 响应小于 compressMinLength：gzip 头尾约 20 字节，把 114 字节的 JSON 压成 121 字节，还多花十几微秒，
//     而接口的大部分响应都不到 1 KB
//   - 非文本内容（图片、音视频、PDF、压缩包、字体本身已经压过）；文件下载另按路径排除，见 compressExcludedPath
//   - SSE 长连接（歌词流、编辑事件、通知）：响应在处理过程中已经逐条写出，结束时不能再整体压缩
//   - 流式响应体（SetBodyStream，如页面 HTML 包里的音视频文件）：Body() 会把整个流读进内存再关闭流，
//     几百 MB 的视频会在发出第一个字节前全部读完，所以必须在碰 Body() 之前先判断 IsBodyStream
//   - HEAD 请求：没有响应体，读 Body() 只会白白读取文件
//   - Range 请求与 206 / Content-Range 响应：Content-Range 指的是原始字节，压缩后断点续传与拖动进度会错位
const (
	compressMinLength = 1024
	compressLevel     = flate.BestSpeed
)

// compressExcludedPath 文件下载带 ETag 与 Range，内容多是已经压过的格式，不参与压缩（改写长度与内容会让它们的缓存校验失效）
const compressExcludedPath = "/api/v1/file/f/"

// UseCompress 压缩文本类响应。注册在其他中间件之前：其他中间件（如文件链接改写）处理完响应体之后再压
func UseCompress() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		if !acceptsGzip(&c.Request) || skipCompressPath(string(c.Request.URI().Path())) {
			c.Next(ctx)
			return
		}
		c.Next(ctx)

		// 以下判断都不能读响应体：流式响应体一旦调用 Body() 就会被整体读进内存
		if c.Response.IsBodyStream() ||
			c.Request.Header.IsHead() ||
			len(c.Request.Header.Peek("Range")) > 0 ||
			c.Response.StatusCode() == consts.StatusPartialContent ||
			len(c.Response.Header.Peek("Content-Range")) > 0 ||
			len(c.Response.Header.Peek("Content-Encoding")) > 0 ||
			!compressibleContentType(c.Response.Header.ContentType()) {
			return
		}
		body := c.Response.Body()
		if len(body) < compressMinLength {
			return
		}
		compressed := hertzcompress.AppendGzipBytesLevel(nil, body, compressLevel)
		// Content-Length 在写出时按实际响应体重算（见 protocol/http1/resp 的 Write）
		c.Response.SetBody(compressed)
		c.Response.Header.Set("Content-Encoding", "gzip")
		c.Response.Header.Set("Vary", "Accept-Encoding")
	}
}

// acceptsGzip 请求是否接受 gzip；SSE 的请求头带 text/event-stream，一并排除
func acceptsGzip(req *protocol.Request) bool {
	if strings.Contains(string(req.Header.Peek("Connection")), "Upgrade") ||
		strings.Contains(string(req.Header.Peek("Accept")), "text/event-stream") {
		return false
	}
	encoding := strings.TrimSpace(string(req.Header.Peek("Accept-Encoding")))
	return strings.Contains(encoding, "gzip") || encoding == "*"
}

// skipCompressPath 逐条写出响应的长连接与文件下载不压缩
func skipCompressPath(path string) bool {
	return strings.HasPrefix(path, compressExcludedPath) ||
		strings.HasSuffix(path, "/stream") || // 歌词流、通知
		strings.HasSuffix(path, "/edit-events") // 编辑事件
}

// compressibleContentType 只压文本类内容；图片、音视频等已经压过，再压只浪费 CPU
func compressibleContentType(contentType []byte) bool {
	mediaType, _, err := mime.ParseMediaType(string(contentType))
	if err != nil || mediaType == "" || mediaType == "text/event-stream" {
		return false
	}
	if strings.HasPrefix(mediaType, "text/") {
		return true
	}
	switch mediaType {
	case "application/json", "application/javascript", "application/xml", "application/xhtml+xml",
		"application/rss+xml", "application/atom+xml", "image/svg+xml":
		return true
	}
	return false
}
