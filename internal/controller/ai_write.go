package v1

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol/http1/resp"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type aiWriteType struct {
	service *service.AIWriteService
}

var AIWrite = &aiWriteType{service: service.NewAIWriteService()}

// Stream 编辑器 AI 写作（帮写 / 润色），targetType 由路由决定（post / page）
// 校验失败时返回普通 JSON 错误；校验通过后以 SSE 推送生成过程
func (a *aiWriteType) Stream(targetType string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		var req dto.AIWriteReq
		if err := c.BindAndValidate(&req); err != nil {
			resps.BadRequest(c, resps.ErrParamInvalid)
			return
		}
		job, svcerr := a.service.Prepare(ctx, targetType, ctxutils.GetIDParam(c).Uint, &req)
		if svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		c.SetStatusCode(http.StatusOK)
		c.Response.Header.Set("Content-Type", "text/event-stream; charset=utf-8")
		c.Response.Header.Set("Cache-Control", "no-cache, no-transform")
		// 关闭反向代理（Nginx 等）的响应缓冲
		c.Response.Header.Set("X-Accel-Buffering", "no")
		c.Response.HijackWriter(resp.NewChunkedBodyWriter(&c.Response, c.GetWriter()))
		a.service.Stream(ctx, job, func(event string, data any) error {
			payload, _ := json.Marshal(data)
			if _, err := c.Write([]byte("event: " + event + "\ndata: " + string(payload) + "\n\n")); err != nil {
				return err
			}
			return c.Flush()
		})
	}
}
