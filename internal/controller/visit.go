package v1

import (
	"context"
	"encoding/json"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

// maxEventBodySize 事件上报的请求体上限
const maxEventBodySize = 16 << 10

type visitType struct {
	service *service.VisitService
}

var Visit = &visitType{service: service.NewVisitService()}

// visitClient 从连接与请求头读取访客的客户端信息
func visitClient(c *app.RequestContext) service.VisitClient {
	return service.VisitClient{
		IP:             c.ClientIP(),
		UserAgent:      string(c.UserAgent()),
		AcceptLanguage: string(c.GetHeader("Accept-Language")),
		CHUA:           string(c.GetHeader("Sec-CH-UA")),
		CHUAMobile:     string(c.GetHeader("Sec-CH-UA-Mobile")),
		CHUAPlatform:   string(c.GetHeader("Sec-CH-UA-Platform")),
		// 浏览器开启“请勿追踪”（DNT）或全局隐私控制（GPC）时只做匿名计数
		DoNotTrack: string(c.GetHeader("DNT")) == "1" || string(c.GetHeader("Sec-GPC")) == "1",
		// 经 Next 代理转发时原始域名在 X-Forwarded-Host 中，用于识别站内跳转
		Hosts: []string{string(c.GetHeader("X-Forwarded-Host")), string(c.Host())},
	}
}

func setVisitorCookie(c *app.RequestContext, visitorKey string) {
	if visitorKey != "" {
		c.SetCookie(service.VisitorCookieName, visitorKey, service.VisitorCookieMaxAge, "/", "", protocol.CookieSameSiteLaxMode, true, true)
	}
}

// Report 浏览器上报一次访问，并刷新访客 Cookie
// 前端已改用兼容 Plausible 的 /event 接口，这里保留给升级过渡期间仍在使用旧版页面的浏览器
func (v *visitType) Report(ctx context.Context, c *app.RequestContext) {
	var req dto.ReportVisitReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	visitorKey, svcerr := v.service.Report(ctx, &req, string(c.Cookie(service.VisitorCookieName)), visitClient(c))
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	setVisitorCookie(c, visitorKey)
	resps.Ok(c, resps.Success, nil)
}

// Event 兼容 Plausible 事件接口：@plausible-analytics/tracker 以 text/plain 发送 JSON
func (v *visitType) Event(ctx context.Context, c *app.RequestContext) {
	body := c.Request.Body()
	var event dto.PlausibleEvent
	if len(body) > maxEventBodySize || json.Unmarshal(body, &event) != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	visitorKey, svcerr := v.service.HandleEvent(ctx, &event, string(c.Cookie(service.VisitorCookieName)), visitClient(c))
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	setVisitorCookie(c, visitorKey)
	resps.Ok(c, resps.Success, nil)
}
