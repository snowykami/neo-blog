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
