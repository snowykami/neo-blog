package middleware

import (
	"bytes"
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
)

var jsonContentType = []byte("application/json")

// UseFileLinks 站内文件链接：写入的 JSON 中存储直链还原为稳定链接，返回的 JSON 中稳定链接改写为可直连存储的直链
func UseFileLinks() app.HandlerFunc {
	apiPrefix := []byte(constant.ApiPrefix + "/")
	return func(ctx context.Context, c *app.RequestContext) {
		if !bytes.HasPrefix(c.Request.URI().Path(), apiPrefix) {
			c.Next(ctx)
			return
		}
		method := string(c.Method())
		if (method == "POST" || method == "PUT" || method == "PATCH") && bytes.HasPrefix(c.Request.Header.ContentType(), jsonContentType) {
			if body, ok := service.NormalizeFileLinks(c.Request.Body()); ok {
				c.Request.SetBody(body)
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
