package v1

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/utils"
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

// SendTestNotification 管理员给自己发一条站内测试通知
func (nc *NotificationController) SendTestNotification(ctx context.Context, c *app.RequestContext) {
	if svcerr := nc.service.SendTestNotification(ctx); svcerr != nil {
		resps.Error(c, svcerr)
		return
	}
	resps.Ok(c, resps.Success, nil)
}
