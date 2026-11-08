package service

import (
	"encoding/json"
	"slices"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 通知归类：重要消息触发邮件，附带消息只在下一封重要邮件里搭车；none 表示这条互动不该产生通知
const (
	notificationKindImportant = "important"
	notificationKindAttached  = "attached"
	notificationKindNone      = "none"
)

// notificationAllTypes 站内通知支持的全部类型，顺序即偏好页的展示顺序
var notificationAllTypes = []string{
	constant.NotificationTypeCommentCreated,
	constant.NotificationTypeCommentReplied,
	constant.NotificationTypeCommentLiked,
	constant.NotificationTypePostLiked,
	constant.NotificationTypeCommentThreadReplied,
}

// notificationSiteConfig 站点级通知配置：邮件总开关与「重要」类型白名单（同时是用户可选的上限，见 N2）
type notificationSiteConfig struct {
	EmailEnable bool
	EmailTypes  []string
}

// currentNotificationSiteConfig 读取站点级通知配置
func currentNotificationSiteConfig() notificationSiteConfig {
	return notificationSiteConfig{
		EmailEnable: config.Bool("notification_email_enable"),
		EmailTypes:  config.Strings("notification_email_types"),
	}
}

// defaultNotificationPrefsFor 用户从未改过偏好时的默认值：站内全开、邮件跟随站点白名单、AI 互动可见
func defaultNotificationPrefsFor(site notificationSiteConfig) model.NotificationPrefs {
	return model.NotificationPrefs{
		InApp:          slices.Clone(notificationAllTypes),
		Email:          slices.Clone(site.EmailTypes),
		AIInteractions: true,
	}
}

// parseNotificationPrefs 解析库里的 JSON 偏好；为空或格式非法时按默认值处理（不因一条坏数据挡住通知）
func parseNotificationPrefs(raw string, defaults model.NotificationPrefs) model.NotificationPrefs {
	if raw == "" {
		return defaults
	}
	var prefs model.NotificationPrefs
	if err := json.Unmarshal([]byte(raw), &prefs); err != nil {
		return defaults
	}
	// 列表为 nil 表示该字段没被写过（手工改库、字段新增），沿用默认值；空数组是用户明确关掉
	if prefs.InApp == nil {
		prefs.InApp = defaults.InApp
	}
	if prefs.Email == nil {
		prefs.Email = defaults.Email
	}
	return prefs
}

// normalizeNotificationPrefs 规整写入的偏好：只保留已知类型并去重；
// 邮件类型只能落在站点白名单内，用户只能关不能开站点没开的类型（N2）
func normalizeNotificationPrefs(prefs model.NotificationPrefs, site notificationSiteConfig) model.NotificationPrefs {
	return model.NotificationPrefs{
		InApp:          filterKnownTypes(prefs.InApp, notificationAllTypes),
		Email:          filterKnownTypes(prefs.Email, site.EmailTypes),
		AIInteractions: prefs.AIInteractions,
	}
}

// marshalNotificationPrefs 序列化为库里的 JSON 文本
func marshalNotificationPrefs(prefs model.NotificationPrefs) (string, error) {
	b, err := json.Marshal(prefs)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// notificationSettings 站点级配置与用户偏好的合并结果，写入路径只读它
type notificationSettings struct {
	InApp          map[string]bool // 允许产生站内通知的类型
	Email          map[string]bool // 允许触发邮件的类型：站点白名单 ∩ 用户选择
	AIInteractions bool            // AI 的互动是否产生通知
	EmailEnabled   bool            // 站点开启了邮件且用户还留有允许的类型
}

// resolveNotificationSettings 合并站点级配置与用户偏好
func resolveNotificationSettings(raw string, site notificationSiteConfig) notificationSettings {
	prefs := normalizeNotificationPrefs(parseNotificationPrefs(raw, defaultNotificationPrefsFor(site)), site)
	return notificationSettings{
		InApp:          toTypeSet(prefs.InApp),
		Email:          toTypeSet(prefs.Email),
		AIInteractions: prefs.AIInteractions,
		EmailEnabled:   site.EmailEnable && len(prefs.Email) > 0,
	}
}

// notificationKind 3.1 的归类：真人评论 / 回复算重要，点赞、线程活动与 AI 的互动都算附带。
// AI 互动另受用户的 ai_interactions 开关控制，见 decideNotification
func notificationKind(eventType string, actorIsAI bool) string {
	if actorIsAI {
		return notificationKindAttached
	}
	switch eventType {
	case constant.NotificationTypeCommentCreated, constant.NotificationTypeCommentReplied:
		return notificationKindImportant
	default:
		return notificationKindAttached
	}
}

// decideNotification 3.2 抑制规则中与数据有关的几条，返回该互动是否给 owner 产生通知及其归类。
// 规则 1（自己互动自己）、2（AI 收不到通知）、3（AI 互动归附带且可被静音）、5（禁用用户）在这里判断；
// 规则 4（私密评论可见性）由调用方在产生事件前用 canViewComment 判断，规则 6（取消点赞）走硬删
func decideNotification(actor, owner *model.User, eventType string, settings notificationSettings) string {
	if actor == nil || owner == nil || actor.ID == owner.ID || owner.IsAI || owner.Disabled {
		return notificationKindNone
	}
	kind := notificationKind(eventType, actor.IsAI)
	// 关掉 AI 互动后连通知行都不产生（N9）
	if actor.IsAI && !settings.AIInteractions {
		return notificationKindNone
	}
	// 站内关掉该类型就不产生通知行：邮件以通知行为载体，因此该类型也就不会进邮件
	if !settings.InApp[eventType] {
		return notificationKindNone
	}
	return kind
}

// notificationEmailState 5.2 的邮件状态初始化：只有重要消息排队等发信，附带消息挂着搭车；
// 站点没开邮件或用户关掉了该类型时直接置 skipped，不占用扫表
func notificationEmailState(kind, eventType string, settings notificationSettings) string {
	if kind == notificationKindImportant {
		if settings.EmailEnabled && settings.Email[eventType] {
			return constant.NotificationEmailStatePending
		}
		return constant.NotificationEmailStateSkipped
	}
	if !settings.EmailEnabled {
		return constant.NotificationEmailStateSkipped
	}
	return constant.NotificationEmailStateAttached
}

func toTypeSet(types []string) map[string]bool {
	set := make(map[string]bool, len(types))
	for _, t := range types {
		set[t] = true
	}
	return set
}

// filterKnownTypes 保留 allowed 中出现的类型，并按 allowed 的顺序去重
func filterKnownTypes(types, allowed []string) []string {
	result := make([]string, 0, len(types))
	for _, candidate := range allowed {
		if slices.Contains(types, candidate) {
			result = append(result, candidate)
		}
	}
	return result
}

// NotificationSettingsURL 邮件底部的「通知设置」链接；带有限的免登录凭据，见 docs/notification-spec.md N11
func NotificationSettingsURL(user *model.User, now time.Time) string {
	return tools.GetBaseUrl() + "/notification-settings?token=" + SignNotificationPrefsToken(user.ID, now)
}
