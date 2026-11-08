package static

import (
	"strings"
	"testing"
)

func TestRenderTemplate(t *testing.T) {
	template, err := RenderTemplate("email/verification-code.tmpl", map[string]interface{}{
		"Lang":       "zh-cn",
		"Preheader":  "验证码 10 分钟内有效",
		"SiteName":   "Test Page",
		"SiteURL":    "https://example.com",
		"SiteIcon":   "https://example.com/icon.png",
		"Heading":    "验证你的邮箱",
		"Greeting":   "你好，我们收到了 xxx@example.com 的验证请求",
		"CodeLabel":  "验证码",
		"Code":       "a1b2c3",
		"ExpireNote": "验证码在 10 分钟内有效",
		"IgnoreNote": "如果不是你本人操作，忽略这封邮件即可",
		"TestNote":   "",
		"FooterNote": "SnowyKami",
		"SentBy":     "本邮件由站点自动发送",
	})
	if err != nil {
		t.Fatalf("渲染模板失败: %v", err)
	}
	// 模板里的每个占位符都要被替换掉，且关键内容出现在正文中
	for _, want := range []string{"a1b2c3", "Test Page", "验证你的邮箱", "https://example.com/icon.png"} {
		if !strings.Contains(template, want) {
			t.Errorf("渲染结果缺少 %q", want)
		}
	}
	if strings.Contains(template, "{{") {
		t.Errorf("渲染结果仍含未替换的占位符")
	}
}

// 测试邮件没有 TestNote 时不显示提示框
func TestRenderTemplateHidesTestNote(t *testing.T) {
	data := map[string]interface{}{"Lang": "en-us", "SiteName": "Blog", "Code": "123456"}
	template, err := RenderTemplate("email/verification-code.tmpl", data)
	if err != nil {
		t.Fatalf("渲染模板失败: %v", err)
	}
	if strings.Contains(template, "background:#fff8e6") {
		t.Error("没有测试提示时不应渲染提示框")
	}
}

// 通知汇总邮件：列表项、附带分区、通知设置链接都要渲染出来；没有附带项时不渲染那个分区
func TestRenderNotificationTemplate(t *testing.T) {
	items := []map[string]any{
		{"ActorAvatar": "", "ActorInitial": "林", "Text": "林小满 评论了你的文章《x》：正文", "URL": "https://example.com/p/x?comment=1", "Time": "12:31"},
	}
	template, err := RenderTemplate("email/notification.tmpl", map[string]interface{}{
		"Lang":          "zh-cn",
		"Preheader":     "你有 1 条新互动",
		"SiteName":      "Test Page",
		"SiteURL":       "https://example.com",
		"SiteIcon":      "https://example.com/icon.png",
		"Heading":       "你有新的互动",
		"Summary":       "过去 10 分钟有 1 条新互动",
		"CTALabel":      "在站内查看全部",
		"InboxURL":      "https://example.com/notifications",
		"Items":         items,
		"MoreItems":     "",
		"AttachedLabel": "另外",
		"AttachedLines": []string{"另有 3 个赞"},
		"FooterNote":    "SnowyKami",
		"SettingsURL":   "https://example.com/notification-settings?token=abc",
		"SettingsLabel": "通知设置",
		"SentBy":        "本邮件由站点自动发送",
	})
	if err != nil {
		t.Fatalf("渲染模板失败: %v", err)
	}
	for _, want := range []string{"https://example.com/p/x?comment=1", "另有 3 个赞", "notification-settings?token=abc", "林"} {
		if !strings.Contains(template, want) {
			t.Errorf("渲染结果缺少 %q", want)
		}
	}
	if strings.Contains(template, "{{") {
		t.Error("渲染结果仍含未替换的占位符")
	}

	// 没有附带项与「还有 N 条」时不渲染这两块
	plain, err := RenderTemplate("email/notification.tmpl", map[string]interface{}{
		"Lang": "en-us", "SiteName": "Blog", "Items": items, "Preheader": "x", "Summary": "y",
	})
	if err != nil {
		t.Fatalf("渲染模板失败: %v", err)
	}
	if strings.Contains(plain, "background:#f7f8fa") {
		t.Error("没有附带项时不应渲染附带分区")
	}
}
