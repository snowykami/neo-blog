package service

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

// ListNotifications 本人的通知列表；分组与排序在仓储里一条查询完成
func (s *NotificationService) ListNotifications(ctx context.Context, req *dto.ListNotificationsReq) ([]dto.NotificationItemDto, int64, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, 0, errs.NewUnauthorized("login_required")
	}
	var types []string
	for _, value := range strings.Split(req.Type, ",") {
		if value = strings.TrimSpace(value); value != "" {
			types = append(types, value)
		}
	}
	groups, total, err := repo.Notification.List(&repo.NotificationFilter{
		UserID:     currentUser.ID,
		OnlyUnread: req.Filter == "unread",
		Types:      types,
		TimeZone:   currentUser.TimeZone,
		Page:       req.Page,
		Size:       req.Size,
	})
	if err != nil {
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("notification")
	}
	items := make([]dto.NotificationItemDto, 0, len(groups))
	for _, group := range groups {
		items = append(items, toNotificationItemDto(&group))
	}
	return items, total, nil
}

// GetUnreadCount 未读徽标：未读的聚合组数
func (s *NotificationService) GetUnreadCount(ctx context.Context) (*dto.NotificationUnreadCountDto, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	total, byType, err := repo.Notification.UnreadGroupCount(currentUser.ID, currentUser.TimeZone)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("notification")
	}
	if byType == nil {
		byType = map[string]int64{}
	}
	latestID, latestAt, err := repo.Notification.LatestActivity(currentUser.ID)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("notification")
	}
	return &dto.NotificationUnreadCountDto{Total: total, ByType: byType, LatestID: latestID, LatestAt: latestAt}, nil
}

// MarkNotificationRead 单条已读，幂等；聚合行会整组置已读
func (s *NotificationService) MarkNotificationRead(ctx context.Context, id uint) (int64, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.NewUnauthorized("login_required")
	}
	affected, err := repo.Notification.MarkRead(currentUser.ID, id, currentUser.TimeZone)
	if err != nil {
		// 别人的通知与不存在的通知返回同一个 404，不暴露存在性
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, errs.NewNotFound("operation_target_not_found").WithResource("notification")
		}
		return 0, errs.Internal("failed_to_update_target", err).WithResource("notification")
	}
	// 有通知变为已读时推送一次：本人其他标签页的徽标随之更新
	if affected > 0 {
		NotificationHub.Notify(currentUser.ID)
	}
	return affected, nil
}

// MarkAllNotificationsRead 全部已读；before_id 为页面打开时已看到的最大通知 id，之后新到的通知保持未读
func (s *NotificationService) MarkAllNotificationsRead(ctx context.Context, req *dto.MarkAllNotificationsReadReq) (int64, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return 0, errs.NewUnauthorized("login_required")
	}
	affected, err := repo.Notification.MarkAllRead(currentUser.ID, req.BeforeID)
	if err != nil {
		return 0, errs.Internal("failed_to_update_target", err).WithResource("notification")
	}
	if affected > 0 {
		NotificationHub.Notify(currentUser.ID)
	}
	return affected, nil
}

// GetNotificationPreferences 读出本人的通知偏好（未设置时返回默认值）与站点级可选范围
func (s *NotificationService) GetNotificationPreferences(ctx context.Context) (*dto.NotificationPreferencesDto, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	return buildNotificationPreferences(currentUser), nil
}

// UpdateNotificationPreferences 保存通知偏好；邮件类型只能落在站点白名单内，用户只能关不能开
func (s *NotificationService) UpdateNotificationPreferences(ctx context.Context, req *dto.UpdateNotificationPreferencesReq) (*dto.NotificationPreferencesDto, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	return saveNotificationPreferences(currentUser, req.InApp, req.Email, req.AIInteractions)
}

// UnsubscribeAllNotifications 一键关掉全部通知邮件（站内通知不受影响）
func (s *NotificationService) UnsubscribeAllNotifications(ctx context.Context) (*dto.NotificationPreferencesDto, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	return saveNotificationPreferences(currentUser, nil, []string{}, nil)
}

// notificationTypeSystemTest 管理员自测用的站内通知类型，不进偏好与邮件
const notificationTypeSystemTest = "system.test"

// SendTestNotification 管理员给自己发一条站内测试通知，用来确认通知链路可用（不能读别人的通知，见第 9 节）
func (s *NotificationService) SendTestNotification(ctx context.Context) *errs.ServiceError {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return errs.NewUnauthorized("login_required")
	}
	// 测试通知不经过 Emit（自己给自己发会被 3.2 规则 1 抑制），直接写一条事件 + 通知
	dedupeKey := "system.test:user:" + itoaRunes(int(currentUser.ID)) + ":" + strconv.FormatInt(time.Now().UnixNano(), 10)
	event, err := repo.Notification.CreateEvent(nil, &model.InteractionEvent{
		Type: notificationTypeSystemTest, ActorID: currentUser.ID, OwnerID: currentUser.ID, DedupeKey: dedupeKey,
	})
	if err != nil {
		return errs.Internal("failed_to_create_target", err).WithResource("notification")
	}
	// 不存标题与正文快照：文案由前端按 type（system.test）用当前界面语言渲染，库里不留某一种语言的文字
	notification := &model.Notification{
		EventID:    event.ID,
		UserID:     currentUser.ID,
		ActorID:    currentUser.ID,
		Type:       notificationTypeSystemTest,
		DedupeKey:  dedupeKey,
		InAppSent:  true,
		EmailState: constant.NotificationEmailStateSkipped, // 测试通知不发邮件
	}
	if err := repo.Notification.CreateNotification(nil, notification); err != nil {
		return errs.Internal("failed_to_create_target", err).WithResource("notification")
	}
	// 与真实通知一样走实时推送，测试通知因此也能验证 SSE 链路（含跨实例广播）
	NotificationHub.Notify(currentUser.ID)
	return nil
}

// buildNotificationPreferences 当前生效的偏好 + 站点级可选范围
func buildNotificationPreferences(user *model.User) *dto.NotificationPreferencesDto {
	site := currentNotificationSiteConfig()
	prefs := normalizeNotificationPrefs(parseNotificationPrefs(user.NotificationPrefs, defaultNotificationPrefsFor(site)), site)
	return &dto.NotificationPreferencesDto{
		InApp:            prefs.InApp,
		Email:            prefs.Email,
		AIInteractions:   prefs.AIInteractions,
		SiteEmailEnabled: site.EmailEnable,
		SiteEmailTypes:   site.EmailTypes,
		AvailableTypes:   slices.Clone(notificationAllTypes),
	}
}

// saveNotificationPreferences 合并保存：nil 表示该字段保持原值
func saveNotificationPreferences(user *model.User, inApp, email []string, aiInteractions *bool) (*dto.NotificationPreferencesDto, *errs.ServiceError) {
	site := currentNotificationSiteConfig()
	current := parseNotificationPrefs(user.NotificationPrefs, defaultNotificationPrefsFor(site))
	next := model.NotificationPrefs{
		InApp:          current.InApp,
		Email:          current.Email,
		AIInteractions: current.AIInteractions,
	}
	if inApp != nil {
		next.InApp = inApp
	}
	if email != nil {
		next.Email = email
	}
	if aiInteractions != nil {
		next.AIInteractions = *aiInteractions
	}
	next = normalizeNotificationPrefs(next, site)
	raw, err := marshalNotificationPrefs(next)
	if err != nil {
		return nil, errs.Internal("failed_to_update_target", err).WithResource("notification")
	}
	if err := repo.User.UpdateUserColumns(user.ID, map[string]any{"notification_prefs": raw}); err != nil {
		return nil, errs.Internal("failed_to_update_target", err).WithResource("notification")
	}
	user.NotificationPrefs = raw
	return buildNotificationPreferences(user), nil
}

// ListNotificationDeliveries 管理员排查邮件投递：只看状态与错误，不读通知内容之外的个人数据
func (s *NotificationService) ListNotificationDeliveries(ctx context.Context, req *dto.ListNotificationDeliveriesReq) ([]dto.NotificationDeliveryDto, int64, *errs.ServiceError) {
	if !ctxutils.IsAdmin(ctx) {
		return nil, 0, errs.NewForbidden("permission_denied")
	}
	rows, total, err := repo.Notification.ListEmailDeliveries(req.State, req.Page, req.Size)
	if err != nil {
		return nil, 0, errs.Internal("failed_to_get_target", err).WithResource("notification")
	}
	items := make([]dto.NotificationDeliveryDto, 0, len(rows))
	for i := range rows {
		item := dto.NotificationDeliveryDto{
			ID:           rows[i].ID,
			UserID:       rows[i].UserID,
			Type:         rows[i].Type,
			SubjectTitle: rows[i].SubjectTitle,
			EmailState:   rows[i].EmailState,
			Attempts:     rows[i].EmailAttempts,
			NextAt:       rows[i].EmailNextAt,
			LastError:    rows[i].EmailLastErr,
			CreatedAt:    rows[i].CreatedAt,
		}
		// 只显示收件邮箱，便于确认发给了谁；查不到用户时留空
		if user, err := repo.User.GetUserByID(rows[i].UserID); err == nil {
			item.UserEmail = user.Email
		}
		items = append(items, item)
	}
	return items, total, nil
}

// RetryNotificationDelivery 管理员手动重试一条投递
func (s *NotificationService) RetryNotificationDelivery(ctx context.Context, id uint) *errs.ServiceError {
	if !ctxutils.IsAdmin(ctx) {
		return errs.NewForbidden("permission_denied")
	}
	now := time.Now()
	retried, err := repo.Notification.RetryEmail(id, now.Add(-NotificationEmailSendingTimeout), now)
	if err != nil {
		return errs.Internal("failed_to_update_target", err).WithResource("notification")
	}
	if retried {
		return nil
	}
	// 没有退回：要么不存在，要么状态不允许重试（已发送、已跳过、等搭车、正在发送且未超时）
	if _, err := repo.Notification.GetEmailDelivery(id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errs.NewNotFound("operation_target_not_found").WithResource("notification")
		}
		return errs.Internal("failed_to_get_target", err).WithResource("notification")
	}
	return errs.NewConflict("notification_delivery_not_retryable")
}

// toNotificationItemDto 仓储的分组行 → 接口 DTO
func toNotificationItemDto(group *repo.NotificationGroup) dto.NotificationItemDto {
	notification := group.Notification
	count := uint64(group.Count)
	if count == 0 {
		count = 1
	}
	item := dto.NotificationItemDto{
		ID:             notification.ID,
		Type:           notification.Type,
		Actor:          notification.Actor.ToDto(),
		ActorIsAI:      notification.Actor.IsAI,
		ActorNames:     group.ActorNames,
		AggregateCount: count,
		SubjectType:    notification.SubjectType,
		SubjectID:      notification.SubjectID,
		SubjectTitle:   notification.SubjectTitle,
		SubjectSlug:    notification.SubjectSlug,
		TargetType:     notification.TargetType,
		TargetID:       notification.TargetID,
		CommentID:      notification.CommentID,
		Excerpt:        notification.Excerpt,
		QuotedExcerpt:  notification.QuotedExcerpt,
		IsRead:         notification.ReadAt != nil,
		CreatedAt:      notification.CreatedAt,
		UpdatedAt:      notification.UpdatedAt,
		ActivityAt:     notification.ActivityAt,
	}
	return item
}

// ListNotificationGroupMembers 展开聚合行：点赞组列出具体是谁，折叠行只有它自己
func (s *NotificationService) ListNotificationGroupMembers(ctx context.Context, id uint) ([]dto.NotificationItemDto, *errs.ServiceError) {
	currentUser, ok := ctxutils.GetCurrentUser(ctx)
	if !ok {
		return nil, errs.NewUnauthorized("login_required")
	}
	rows, err := repo.Notification.ListGroupMembers(currentUser.ID, id, currentUser.TimeZone, 50)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.NewNotFound("operation_target_not_found").WithResource("notification")
		}
		return nil, errs.Internal("failed_to_get_target", err).WithResource("notification")
	}
	items := make([]dto.NotificationItemDto, 0, len(rows))
	for i := range rows {
		group := repo.NotificationGroup{Notification: rows[i], Count: 1, UnreadCount: boolToInt(rows[i].ReadAt == nil)}
		items = append(items, toNotificationItemDto(&group))
	}
	return items, nil
}

func boolToInt(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

// AcquireNotificationStream 为一条 SSE 连接占用名额（每个用户跨实例合计最多 NotificationStreamMaxPerUser 条）；
// 成功时返回的释放函数必须在连接结束时调用
func (s *NotificationService) AcquireNotificationStream(userID uint) (func(), *errs.ServiceError) {
	release, ok, err := NotificationHub.AcquireStreamSlot(userID)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err).WithResource("notification")
	}
	if !ok {
		return nil, errs.NewTooManyRequests("too_many_requests")
	}
	return release, nil
}
