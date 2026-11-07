package v1

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol/http1/resp"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

var (
	// editEventHeartbeat 编辑事件流的心跳间隔：需短于反向代理的读超时（ingress-nginx 默认 60 秒），
	// 也用于及时发现客户端已断开（写入失败即结束）
	editEventHeartbeat = 20 * time.Second
	// editEventMaxDuration 单个事件流的最长时长：权限只在连接时校验，到时结束，客户端重连时重新校验（登出、权限变化后不再收到事件）
	editEventMaxDuration = 30 * time.Minute
)

type editSessionType struct {
	service *service.EditSessionService
}

var EditSession = &editSessionType{service: service.NewEditSessionService()}

// Acquire 开启编辑会话并顶掉旧会话，targetType 由路由决定（post / page）
func (e *editSessionType) Acquire(targetType string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		id := ctxutils.GetIDParam(c).Uint
		session, svcerr := e.service.Acquire(ctx, targetType, id, string(c.UserAgent()))
		if svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		resps.Ok(c, resps.Success, session)
	}
}

// Current 获取当前持有编辑会话的信息
func (e *editSessionType) Current(targetType string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		id := ctxutils.GetIDParam(c).Uint
		session, svcerr := e.service.Current(ctx, targetType, id, string(c.GetHeader("X-Edit-Session")))
		if svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		resps.Ok(c, resps.Success, session)
	}
}

// Events 编辑事件流（SSE）：保存与编辑会话变化时推送，事件不携带内容，客户端收到后自行拉取
// 无权限时返回普通 JSON 错误；连接建立后先推送 ready（客户端重连后据此重新拉取），之后定时发送心跳注释，到最长时长后结束
func (e *editSessionType) Events(targetType string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		sub, svcerr := e.service.SubscribeEvents(ctx, targetType, ctxutils.GetIDParam(c).Uint)
		if svcerr != nil {
			resps.Error(c, svcerr)
			return
		}
		defer sub.Close()
		c.SetStatusCode(http.StatusOK)
		c.Response.Header.Set("Content-Type", "text/event-stream; charset=utf-8")
		// no-transform：反向代理与 CDN（以及 Next.js 的压缩）不压缩、不改写，事件逐条到达
		c.Response.Header.Set("Cache-Control", "no-cache, no-transform")
		// 关闭反向代理（Nginx / OpenResty 等）的响应缓冲
		c.Response.Header.Set("X-Accel-Buffering", "no")
		c.Response.HijackWriter(resp.NewChunkedBodyWriter(&c.Response, c.GetWriter()))
		write := func(chunk string) bool {
			if _, err := c.Write([]byte(chunk)); err != nil {
				return false
			}
			return c.Flush() == nil
		}
		event := func(name string, data any) string {
			payload, _ := json.Marshal(data)
			return "event: " + name + "\ndata: " + string(payload) + "\n\n"
		}
		if !write(event("ready", struct{}{})) {
			return
		}
		heartbeat := time.NewTicker(editEventHeartbeat)
		defer heartbeat.Stop()
		expire := time.NewTimer(editEventMaxDuration)
		defer expire.Stop()
		for {
			select {
			case ev := <-sub.Events:
				if !write(event(ev.Type, ev)) {
					return
				}
			case <-heartbeat.C:
				if !write(": ping\n\n") {
					return
				}
			case <-sub.Done:
				return
			case <-expire.C:
				return
			case <-ctx.Done():
				return
			}
		}
	}
}
