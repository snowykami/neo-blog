package service

import (
	"testing"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

var testSite = notificationSiteConfig{
	EmailEnable: true,
	EmailTypes:  []string{constant.NotificationTypeCommentCreated, constant.NotificationTypeCommentReplied},
}

func TestParseNotificationPrefs(t *testing.T) {
	defaults := defaultNotificationPrefsFor(testSite)
	if got := parseNotificationPrefs("", defaults); len(got.InApp) != len(notificationAllTypes) || !got.AIInteractions {
		t.Fatalf("empty raw should fall back to defaults, got %+v", got)
	}
	// 坏数据按默认值处理，不能挡住通知
	if got := parseNotificationPrefs("{not json", defaults); len(got.InApp) != len(notificationAllTypes) {
		t.Fatalf("invalid json should fall back to defaults, got %+v", got)
	}
	// 缺字段沿用默认值，空数组表示用户明确关掉
	got := parseNotificationPrefs(`{"inapp":[],"ai_interactions":false}`, defaults)
	if len(got.InApp) != 0 || got.AIInteractions {
		t.Fatalf("explicit empty list should be kept, got %+v", got)
	}
	if len(got.Email) != len(testSite.EmailTypes) {
		t.Fatalf("missing email field should fall back to defaults, got %+v", got.Email)
	}
}

func TestNormalizeNotificationPrefs(t *testing.T) {
	// AI 互动、线程活动这类不在白名单里的类型不能靠用户自己打开；未知类型被丢弃；重复项去重
	prefs := model.NotificationPrefs{
		InApp:          []string{constant.NotificationTypePostLiked, "unknown", constant.NotificationTypePostLiked, constant.NotificationTypeCommentCreated},
		Email:          []string{constant.NotificationTypePostLiked, constant.NotificationTypeCommentReplied, constant.NotificationTypeCommentReplied},
		AIInteractions: false,
	}
	got := normalizeNotificationPrefs(prefs, testSite)
	if len(got.InApp) != 2 || got.InApp[0] != constant.NotificationTypeCommentCreated || got.InApp[1] != constant.NotificationTypePostLiked {
		t.Fatalf("inapp = %v", got.InApp)
	}
	if len(got.Email) != 1 || got.Email[0] != constant.NotificationTypeCommentReplied {
		t.Fatalf("email = %v", got.Email)
	}
	if got.AIInteractions {
		t.Fatal("ai_interactions should be kept")
	}
}

func TestResolveNotificationSettings(t *testing.T) {
	// 用户全部关掉邮件
	site := testSite
	settings := resolveNotificationSettings(`{"inapp":["comment.created"],"email":[]}`, site)
	if settings.EmailEnabled {
		t.Fatal("email should be disabled when the user allows nothing")
	}
	if !settings.InApp[constant.NotificationTypeCommentCreated] || settings.InApp[constant.NotificationTypePostLiked] {
		t.Fatalf("inapp = %v", settings.InApp)
	}
	// 站点关掉邮件总开关
	site.EmailEnable = false
	if resolveNotificationSettings("", site).EmailEnabled {
		t.Fatal("email should follow the site switch")
	}
	// 站点收窄白名单后，用户原本的邮件类型跟着收窄
	site = notificationSiteConfig{EmailEnable: true, EmailTypes: []string{constant.NotificationTypeCommentReplied}}
	settings = resolveNotificationSettings("", site)
	if settings.Email[constant.NotificationTypeCommentCreated] || !settings.Email[constant.NotificationTypeCommentReplied] {
		t.Fatalf("email types should follow the site whitelist, got %v", settings.Email)
	}
}

// testUser 构造带指定 ID 的用户（gorm.Model 内嵌的 ID 不能在字面量里设置）
func testUser(id uint, customize func(*model.User)) *model.User {
	user := &model.User{}
	user.ID = id
	if customize != nil {
		customize(user)
	}
	return user
}

func TestDecideNotification(t *testing.T) {
	settings := resolveNotificationSettings("", testSite)
	actor := testUser(1, nil)
	owner := testUser(2, nil)
	aiActor := testUser(3, func(u *model.User) { u.IsAI = true })
	aiOwner := testUser(2, func(u *model.User) { u.IsAI = true })
	disabledOwner := testUser(2, func(u *model.User) { u.Disabled = true })
	aiMuted := resolveNotificationSettings(`{"inapp":["comment.created"],"email":["comment.created"],"ai_interactions":false}`, testSite)
	likesMuted := resolveNotificationSettings(`{"inapp":["comment.created"],"email":["comment.created"]}`, testSite)

	cases := []struct {
		name      string
		actor     *model.User
		owner     *model.User
		eventType string
		settings  notificationSettings
		want      string
	}{
		{"自己评论自己", actor, actor, constant.NotificationTypeCommentCreated, settings, notificationKindNone},
		{"AI 收不到通知", actor, aiOwner, constant.NotificationTypeCommentCreated, settings, notificationKindNone},
		{"禁用用户收不到通知", actor, disabledOwner, constant.NotificationTypeCommentCreated, settings, notificationKindNone},
		{"真人评论是重要消息", actor, owner, constant.NotificationTypeCommentCreated, settings, notificationKindImportant},
		{"真人回复是重要消息", actor, owner, constant.NotificationTypeCommentReplied, settings, notificationKindImportant},
		{"点赞是附带", actor, owner, constant.NotificationTypePostLiked, settings, notificationKindAttached},
		{"线程活动是附带", actor, owner, constant.NotificationTypeCommentThreadReplied, settings, notificationKindAttached},
		{"AI 的评论也是附带", aiActor, owner, constant.NotificationTypeCommentCreated, settings, notificationKindAttached},
		{"关掉 AI 互动后连通知行都不产生", aiActor, owner, constant.NotificationTypeCommentCreated, aiMuted, notificationKindNone},
		{"站内关掉的类型不产生通知", actor, owner, constant.NotificationTypePostLiked, likesMuted, notificationKindNone},
	}
	for _, tc := range cases {
		if got := decideNotification(tc.actor, tc.owner, tc.eventType, tc.settings); got != tc.want {
			t.Errorf("%s: got %s, want %s", tc.name, got, tc.want)
		}
	}
}

func TestNotificationEmailState(t *testing.T) {
	settings := resolveNotificationSettings("", testSite)
	if got := notificationEmailState(notificationKindImportant, constant.NotificationTypeCommentCreated, settings); got != constant.NotificationEmailStatePending {
		t.Fatalf("important = %s", got)
	}
	if got := notificationEmailState(notificationKindAttached, constant.NotificationTypePostLiked, settings); got != constant.NotificationEmailStateAttached {
		t.Fatalf("attached = %s", got)
	}
	// 用户关掉了邮件：重要与附带都直接跳过，不占用扫表
	off := resolveNotificationSettings(`{"inapp":["comment.created"],"email":[]}`, testSite)
	if got := notificationEmailState(notificationKindImportant, constant.NotificationTypeCommentCreated, off); got != constant.NotificationEmailStateSkipped {
		t.Fatalf("important with email off = %s", got)
	}
	if got := notificationEmailState(notificationKindAttached, constant.NotificationTypePostLiked, off); got != constant.NotificationEmailStateSkipped {
		t.Fatalf("attached with email off = %s", got)
	}
	// 线程活动永远不该自己触发发信
	if settings.Email[constant.NotificationTypeCommentThreadReplied] {
		t.Fatal("thread activity must never be an important type")
	}
}

func TestNotificationKind(t *testing.T) {
	if notificationKind(constant.NotificationTypeCommentLiked, true) != notificationKindAttached {
		t.Fatal("AI likes are attached")
	}
	if notificationKind(constant.NotificationTypeCommentCreated, false) != notificationKindImportant {
		t.Fatal("human comments are important")
	}
}
