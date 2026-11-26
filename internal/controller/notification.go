package v1

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
	"github.com/cloudwego/hertz/pkg/protocol/http1/resp"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/resps"
)

type NotificationController struct {
	service *service.NotificationService
}

func NewNotificationController() *NotificationController {
	return &NotificationController{
		service: service.NewNotificationService(),
	}
}

// ListNotifications 本人的通知列表；filter=all / unread，type 支持逗号分隔
func (nc *NotificationController) ListNotifications(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListNotificationsReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	items, total, svcerr := nc.service.ListNotifications(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"notifications": items, "total": total})
}

// GetUnreadCount 未读徽标：未读的聚合组数
func (nc *NotificationController) GetUnreadCount(ctx context.Context, c *app.RequestContext) {
	count, svcerr := nc.service.GetUnreadCount(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, count)
}

// ListGroupMembers 展开聚合行，返回组里的明细
func (nc *NotificationController) ListGroupMembers(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	items, svcerr := nc.service.ListNotificationGroupMembers(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"notifications": items})
}

// MarkRead 单条已读，幂等；聚合行整组已读
func (nc *NotificationController) MarkRead(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	affected, svcerr := nc.service.MarkNotificationRead(ctx, id)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"affected": affected})
}

// MarkAllRead 全部已读
func (nc *NotificationController) MarkAllRead(ctx context.Context, c *app.RequestContext) {
	req := &dto.MarkAllNotificationsReadReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	affected, svcerr := nc.service.MarkAllNotificationsRead(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"affected": affected})
}

// GetPreferences 读出通知偏好与站点级可选范围
func (nc *NotificationController) GetPreferences(ctx context.Context, c *app.RequestContext) {
	prefs, svcerr := nc.service.GetNotificationPreferences(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, prefs)
}

// UpdatePreferences 保存通知偏好
func (nc *NotificationController) UpdatePreferences(ctx context.Context, c *app.RequestContext) {
	req := &dto.UpdateNotificationPreferencesReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	prefs, svcerr := nc.service.UpdateNotificationPreferences(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, prefs)
}

// UnsubscribeAll 一键关掉全部通知邮件
func (nc *NotificationController) UnsubscribeAll(ctx context.Context, c *app.RequestContext) {
	prefs, svcerr := nc.service.UnsubscribeAllNotifications(ctx)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, prefs)
}

// ListDeliveries 管理员查看邮件投递状态
func (nc *NotificationController) ListDeliveries(ctx context.Context, c *app.RequestContext) {
	req := &dto.ListNotificationDeliveriesReq{}
	if err := c.BindAndValidate(req); err != nil {
		resps.BadRequest(c, resps.ErrParamInvalid)
		return
	}
	items, total, svcerr := nc.service.ListNotificationDeliveries(ctx, req)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, utils.H{"deliveries": items, "total": total})
}

// RetryDelivery 管理员手动重试一条投递
func (nc *NotificationController) RetryDelivery(ctx context.Context, c *app.RequestContext) {
	id := ctxutils.GetIDParam(c).Uint
	if svcerr := nc.service.RetryNotificationDelivery(ctx, id); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

// SendTestNotification 管理员给自己发一条站内测试通知
func (nc *NotificationController) SendTestNotification(ctx context.Context, c *app.RequestContext) {
	if svcerr := nc.service.SendTestNotification(ctx); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}

var (
	// notificationStreamHeartbeat SSE 心跳间隔：短于反向代理读超时，并在非 netpoll 环境下兜底探测对端关闭
	notificationStreamHeartbeat = 20 * time.Second
	// notificationStreamMaxLifetime 单条 SSE 连接的最长存活时间：到点主动关闭，前端会自动重连，
	// 避免客户端异常断开时在服务端留下一条永不结束的连接
	notificationStreamMaxLifetime = 10 * time.Minute
)

// StreamNotifications SSE：有新通知时推一条当前未读数与最近一条通知的标记（latest_id / latest_at）；
// 保持在当前请求协程内用 ChunkedBodyWriter 同步写出并配合 WithSenseClientDisconnection，客户端刷新或关闭页面时 ctx 立即取消并释放名额
func (nc *NotificationController) StreamNotifications(ctx context.Context, c *app.RequestContext) {
	userID, ok := ctxutils.GetCurrentUserID(ctx)
	if !ok {
		resps.Unauthorized(c, "login_required")
		return
	}
	// 每个用户的连接数有上限（跨实例合计）；名额满了返回 429，前端退回轮询
	release, svcerr := nc.service.AcquireNotificationStream(userID)
	if svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	defer release()

	subscription, unsubscribe := service.NotificationHub.Subscribe(userID)
	defer unsubscribe()

	c.SetStatusCode(http.StatusOK)
	c.Response.Header.Set("Content-Type", "text/event-stream; charset=utf-8")
	c.Response.Header.Set("Cache-Control", "no-cache, no-transform")
	c.Response.Header.Set("X-Accel-Buffering", "no")
	c.Response.HijackWriter(resp.NewChunkedBodyWriter(&c.Response, c.GetWriter()))

	writeChunk := func(chunk string) bool {
		if _, err := c.Write([]byte(chunk)); err != nil {
			return false
		}
		return c.Flush() == nil
	}
	writeEvent := func() bool {
		count, svcerr := nc.service.GetUnreadCount(ctx)
		if svcerr != nil {
			return true // 数据库抖动时跳过这一条，连接继续
		}
		payload, err := json.Marshal(count)
		if err != nil {
			return true
		}
		return writeChunk("event: unread\ndata: " + string(payload) + "\n\n")
	}

	// 连上先给一次当前值，前端不必再单独请求
	if !writeEvent() {
		return
	}

	ticker := time.NewTicker(notificationStreamHeartbeat)
	defer ticker.Stop()
	expire := time.NewTimer(notificationStreamMaxLifetime)
	defer expire.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-service.NotificationHub.Done():
			return
		case <-subscription:
			if !writeEvent() {
				return
			}
		case <-ticker.C:
			// 心跳注释行，保持连接不被中间设备掐断
			if !writeChunk(": ping\n\n") {
				return
			}
		case <-expire.C:
			return
		}
	}
}
