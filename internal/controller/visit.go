package v1

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

// maxEventBatchBodySize 单条或批量事件上报的请求体上限
const maxEventBatchBodySize = 64 << 10

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
		if svcerr.Code == http.StatusTooManyRequests {
			c.Header("Retry-After", "60")
		}
		resps.Error(c, svcerr)
		return
	}
	setVisitorCookie(c, visitorKey)
	resps.Ok(c, resps.Success, nil)
}

// Event 兼容 Plausible 单条与批量事件接口：支持单条对象、事件数组及 {"events": [...]} 三种 JSON 形态
func (v *visitType) Event(ctx context.Context, c *app.RequestContext) {
	body, ok := readBoundedBody(c, maxEventBatchBodySize)
	if !ok {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	events, ok := parsePlausibleEvents(body)
	if !ok {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	visitorKey, svcerr := v.service.HandleEvents(ctx, events, string(c.Cookie(service.VisitorCookieName)), visitClient(c))
	setVisitorCookie(c, visitorKey)
	if svcerr != nil {
		if svcerr.Code == http.StatusTooManyRequests {
			c.Header("Retry-After", "60")
		}
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

// readBoundedBody 受限读取请求体：流式模式下使用 LimitReader 截断，防止超大流式请求整包读入内存导致 OOM
func readBoundedBody(c *app.RequestContext, limit int) ([]byte, bool) {
	if c.Request.Header.ContentLength() > limit {
		c.Response.SetConnectionClose()
		return nil, false
	}
	if c.Request.IsBodyStream() {
		stream := c.Request.BodyStream()
		if stream == nil {
			return nil, false
		}
		buf, err := io.ReadAll(io.LimitReader(stream, int64(limit)+1))
		if err != nil || len(buf) > limit {
			c.Response.SetConnectionClose()
			return nil, false
		}
		return buf, true
	}
	body := c.Request.Body()
	if len(body) > limit {
		c.Response.SetConnectionClose()
		return nil, false
	}
	return body, true
}

type plausibleObjectEnvelope struct {
	dto.PlausibleEvent
	Events json.RawMessage `json:"events"`
}

func decodeSingleJSONValue(data []byte, dst any) bool {
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(dst); err != nil {
		return false
	}
	var extra any
	return dec.Decode(&extra) == io.EOF
}

func parsePlausibleEvents(body []byte) ([]dto.PlausibleEvent, bool) {
	if len(body) > maxEventBatchBodySize {
		return nil, false
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return nil, false
	}
	switch trimmed[0] {
	case '[':
		var events []dto.PlausibleEvent
		if !decodeSingleJSONValue(trimmed, &events) || len(events) == 0 || len(events) > service.MaxEventBatchItems {
			return nil, false
		}
		return events, true
	case '{':
		var env plausibleObjectEnvelope
		if !decodeSingleJSONValue(trimmed, &env) {
			return nil, false
		}
		if len(env.Events) > 0 {
			// 禁止在同一对象内混传单条事件字段与批量 events 数组
			if env.Name != "" || env.URL != "" || env.Domain != "" || env.Referrer != nil ||
				env.Props != nil || env.ScrollDepth != nil || env.EngagedMs != nil {
				return nil, false
			}
			rawEvents := bytes.TrimSpace(env.Events)
			if len(rawEvents) == 0 || bytes.Equal(rawEvents, []byte("null")) {
				return nil, false
			}
			var events []dto.PlausibleEvent
			if !decodeSingleJSONValue(rawEvents, &events) || len(events) == 0 || len(events) > service.MaxEventBatchItems {
				return nil, false
			}
			return events, true
		}
		return []dto.PlausibleEvent{env.PlausibleEvent}, true
	default:
		return nil, false
	}
}
