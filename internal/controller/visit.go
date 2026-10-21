package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type visitType struct {
	service *service.VisitService
}

var Visit = &visitType{service: service.NewVisitService()}

// Report 浏览器上报一次访问，并刷新访客 Cookie
func (v *visitType) Report(ctx context.Context, c *app.RequestContext) {
	var req dto.ReportVisitReq
	if err := c.BindAndValidate(&req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	// 浏览器开启“请勿追踪”（DNT）或全局隐私控制（GPC）时只做匿名计数
	doNotTrack := string(c.GetHeader("DNT")) == "1" || string(c.GetHeader("Sec-GPC")) == "1"
	// 经 Next 代理转发时原始域名在 X-Forwarded-Host 中，用于识别站内跳转
	requestHosts := []string{string(c.GetHeader("X-Forwarded-Host")), string(c.Host())}
	visitorKey, svcerr := v.service.Report(ctx, &req, string(c.Cookie(service.VisitorCookieName)), c.ClientIP(), string(c.UserAgent()), doNotTrack, requestHosts...)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	if visitorKey != "" {
		c.SetCookie(service.VisitorCookieName, visitorKey, service.VisitorCookieMaxAge, "/", "", protocol.CookieSameSiteLaxMode, true, true)
	}
	resps.Ok(c, resps.Success, nil)
}
