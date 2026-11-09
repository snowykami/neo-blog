package service

import (
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestRenderNotificationEmail(t *testing.T) {
	// 站点名称、地址、图标都取自配置（配置读取需要数据库）
	setupNotificationDB(t)
	recipient := &model.User{Nickname: "收件人", Language: "zh"}
	recipient.ID = 7
	actor := &model.User{Nickname: "林小满", Username: "lin", AvatarUrl: "https://example.com/a.png"}
	actor.ID = 3
	created := time.Now().Add(-10 * time.Minute)
	important := []model.Notification{
		{
			Type: constant.NotificationTypeCommentCreated, ActorID: actor.ID, Actor: *actor,
			SubjectType: constant.TargetTypePost, SubjectID: 12, SubjectTitle: "关于把博客换成 Next.js 这件事", SubjectSlug: "nextjs",
			CommentID: 34, Excerpt: "是霞鹜文楷，站内就是它",
		},
	}
	important[0].CreatedAt = created
	// 另一个收件人看到的是英文
	content, err := RenderNotificationEmail(&NotificationEmailInput{
		Recipient: recipient, Important: important, ImportantAll: 12, Interval: 10 * time.Minute,
		Attached:    NotificationAttachedSummary("zh", 3, 1, true),
		SettingsURL: "https://example.com/notification-settings?token=abc",
		Now:         time.Now(),
	})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(content.Subject, "12 条新互动") {
		t.Errorf("subject should count important items only, got %q", content.Subject)
	}
	for _, want := range []string{"林小满", "关于把博客换成 Next.js 这件事", "/p/nextjs?comment=34", "另有 3 个赞", "AI 助手 也回复了你", "另有 1 条线程回复", "还有 11 条"} {
		if !strings.Contains(content.HTML, want) {
			t.Errorf("mail body missing %q", want)
		}
	}

	// 只有一条时用单条主题
	single, err := RenderNotificationEmail(&NotificationEmailInput{
		Recipient: recipient, Important: important, ImportantAll: 1, Interval: 10 * time.Minute, Now: time.Now(),
	})
	if err != nil {
		t.Fatalf("render single: %v", err)
	}
	if !strings.HasPrefix(single.Subject, "林小满 评论了你的文章") {
		t.Errorf("single subject = %q", single.Subject)
	}

	// 收件人语言决定正文语言
	english, err := RenderNotificationEmail(&NotificationEmailInput{
		Recipient: &model.User{Language: "en"}, Important: important, ImportantAll: 1, Now: time.Now(),
	})
	if err != nil {
		t.Fatalf("render english: %v", err)
	}
	if !strings.Contains(english.HTML, "commented on your post") {
		t.Error("english recipient should get english copy")
	}
}

// 作者资料读不到（已注销、关联未加载）时用该语言的「有人」兜底，不能把「—」写进句子
func TestRenderNotificationEmailActorFallback(t *testing.T) {
	setupNotificationDB(t)
	render := func(language string) *NotificationEmailContent {
		t.Helper()
		content, err := RenderNotificationEmail(&NotificationEmailInput{
			Recipient: &model.User{Language: language},
			Important: []model.Notification{{
				Type:        constant.NotificationTypeCommentCreated,
				SubjectType: constant.TargetTypePost, SubjectID: 1, SubjectTitle: "标题", SubjectSlug: "slug",
				CommentID: 2, Excerpt: "正文",
			}},
			ImportantAll: 1, Interval: 10 * time.Minute, Now: time.Now(),
		})
		if err != nil {
			t.Fatalf("render: %v", err)
		}
		return content
	}
	zh := render("zh")
	if !strings.Contains(zh.HTML, "有人 评论了你的文章") || !strings.Contains(zh.Subject, "有人") {
		t.Fatalf("zh fallback actor missing: subject=%q", zh.Subject)
	}
	if strings.Contains(zh.HTML, "— 评论了") {
		t.Error("fallback actor should not be a dash")
	}
	if en := render("en"); !strings.Contains(en.Subject, "Someone") {
		t.Errorf("en fallback actor = %q", en.Subject)
	}
}

func TestNotificationEmailTextsForLanguage(t *testing.T) {
	cases := map[string]string{
		"":        "en",
		"zh":      "zh",
		"zh-CN":   "zh",
		"zh-TW":   "zh-tw",
		"zh-Hant": "zh-tw",
		"en-US":   "en",
		"ja-JP":   "ja",
		"ko":      "ko",
		"fr":      "en",
	}
	for lang, want := range cases {
		got := notificationEmailTextsForLanguage(lang)
		// 用 heading 反查语言键
		found := ""
		for key, texts := range notificationEmailTextsByLanguage {
			if texts.heading == got.heading {
				found = key
			}
		}
		if found != want {
			t.Errorf("language %q → %q, want %q", lang, found, want)
		}
	}
}

func TestNotificationAttachedSummary(t *testing.T) {
	lines := NotificationAttachedSummary("zh", 3, 2, true)
	if len(lines) != 3 || lines[0] != "另有 3 个赞" || lines[2] != "另有 2 条线程回复" {
		t.Fatalf("attached lines = %v", lines)
	}
	if lines := NotificationAttachedSummary("en", 0, 0, false); len(lines) != 0 {
		t.Fatalf("empty attached lines = %v", lines)
	}
}
