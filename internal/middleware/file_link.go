package middleware

import (
	"bytes"
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
)

var jsonContentType = []byte("application/json")

// maxFileLinkJSONBytes 请求 JSON 体链接改写上限（8 MiB）：开启流式请求体时避免把超大伪造 JSON 整包读入内存做正则替换
const maxFileLinkJSONBytes = 8 << 20

// UseFileLinks 站内文件链接：写入的 JSON 中存储直链还原为稳定链接，返回的 JSON 中稳定链接改写为可直连存储的直链
func UseFileLinks() app.HandlerFunc {
	apiPrefix := []byte(constant.ApiPrefix + "/")
	return func(ctx context.Context, c *app.RequestContext) {
		if !bytes.HasPrefix(c.Request.URI().Path(), apiPrefix) {
			c.Next(ctx)
			return
		}
		method := string(c.Method())
		if (method == "POST" || method == "PUT" || method == "PATCH") && bytes.HasPrefix(c.Request.Header.ContentType(), jsonContentType) &&
			c.Request.Header.ContentLength() <= maxFileLinkJSONBytes && (!c.Request.IsBodyStream() || c.Request.Header.ContentLength() >= 0) {
			if body := c.Request.Body(); len(body) <= maxFileLinkJSONBytes {
				if next, ok := service.NormalizeFileLinks(body); ok {
					c.Request.SetBody(next)
				}
			}
		}
		c.Next(ctx)
		if method == "GET" && c.Response.StatusCode() == 200 && !c.Response.IsBodyStream() &&
			bytes.HasPrefix(c.Response.Header.ContentType(), jsonContentType) {
			if body, ok := service.RewriteFileLinks(c.Response.Body()); ok {
				c.Response.SetBody(body)
			}
		}
	}
}
