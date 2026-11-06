package v1

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type telemetryType struct {
	service *service.ErrorReportService
}

var Telemetry = &telemetryType{service: service.NewErrorReportService()}

// Envelope 接收错误报告：前端的 Sentry SDK 经 Next 服务端（还原源码位置后）转发，Next 服务端的错误也从这里上报
func (t *telemetryType) Envelope(ctx context.Context, c *app.RequestContext) {
	body := c.Request.Body()
	if len(body) > service.MaxErrorEnvelopeSize {
		resps.Custom(c, http.StatusRequestEntityTooLarge, "request_entity_too_large", nil)
		return
	}
	client := service.ErrorReportClient{
		IP:         c.ClientIP(),
		UserAgent:  string(c.UserAgent()),
		VisitorKey: string(c.Cookie(service.VisitorCookieName)),
		DoNotTrack: string(c.GetHeader("DNT")) == "1" || string(c.GetHeader("Sec-GPC")) == "1",
	}
	if svcerr := t.service.IngestEnvelope(ctx, body, client); svcerr != nil {
		// SDK 收到 429 时按 Retry-After 暂停上报
		if svcerr.Code == http.StatusTooManyRequests {
			c.Header("Retry-After", "60")
		}
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
