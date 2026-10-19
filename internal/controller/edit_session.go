package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
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
