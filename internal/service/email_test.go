package service

import (
	"net/http"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
)

// 邮件正文的语言跟随站点默认语言，站点名称、地址与图标取自站点配置
func TestRenderVerifyCodeEmailContent(t *testing.T) {
	setupEditTest(t)
	if err := repo.KV.SetKV("site_name", "轻雪的小站"); err != nil {
		t.Fatal(err)
	}
	if err := repo.KV.SetKV("default_language", "zh-cn"); err != nil {
		t.Fatal(err)
	}
	subject, html, svcerr := renderVerifyCodeEmail("reader@example.com", "a1b2c3", false)
	if svcerr != nil {
		t.Fatalf("render: %+v", svcerr)
	}
	if !strings.Contains(subject, "轻雪的小站") {
		t.Errorf("主题里应带上站点名称: %q", subject)
	}
	for _, want := range []string{"轻雪的小站", "验证你的邮箱", "a1b2c3", "reader@example.com", "10 分钟"} {
		if !strings.Contains(html, want) {
			t.Errorf("正文缺少 %q", want)
		}
	}
	// 普通验证码邮件不带测试提示
	if strings.Contains(html, "这是一封测试邮件") {
		t.Error("普通邮件不应出现测试提示")
	}
	if !strings.Contains(html, "本邮件由站点自动发送") {
		t.Error("缺少页脚说明")
	}
	// 占位符都要替换掉：收件箱预览文字曾经漏了有效分钟数
	if strings.Contains(html, "%d") || strings.Contains(html, "%s") {
		t.Error("正文里残留未替换的格式占位符")
	}
}

// 站点语言变化时正文跟着换
func TestRenderVerifyCodeEmailLanguage(t *testing.T) {
	setupEditTest(t)
	cases := map[string]string{
		"zh-tw": "驗證你的電子郵件",
		"en-us": "Verify your email",
		"ja-jp": "メールアドレスの確認",
		"ko-kr": "이메일 주소 확인",
	}
	for language, want := range cases {
		if err := repo.KV.SetKV("default_language", language); err != nil {
			t.Fatal(err)
		}
		_, html, svcerr := renderVerifyCodeEmail("reader@example.com", "a1b2c3", false)
		if svcerr != nil {
			t.Fatalf("%s: render: %+v", language, svcerr)
		}
		if !strings.Contains(html, want) {
			t.Errorf("%s: 正文应包含 %q", language, want)
		}
	}
}

// 没有对应语言的文案时按英文（站点语言是枚举，实际取值都在上表里，这里直接测选择函数）
func TestEmailTextsFallbackToEnglish(t *testing.T) {
	english := emailTextsForLanguage("en-us")
	for _, language := range []string{"fr-fr", "", "  "} {
		if got := emailTextsForLanguage(language); got.heading != english.heading {
			t.Errorf("%q: 应回退英文，实际 %q", language, got.heading)
		}
	}
	if got := emailTextsForLanguage("ZH-TW"); got.heading != "驗證你的電子郵件" {
		t.Errorf("语言标签大小写不敏感，实际 %q", got.heading)
	}
}

// 测试邮件带提示框，且不提示「忽略这封邮件」
func TestRenderVerifyCodeEmailTestMode(t *testing.T) {
	setupEditTest(t)
	subject, html, svcerr := renderVerifyCodeEmail("admin@example.com", "123456", true)
	if svcerr != nil {
		t.Fatalf("render: %+v", svcerr)
	}
	if !strings.Contains(subject, "邮件配置测试") {
		t.Errorf("测试邮件的主题应标明用途: %q", subject)
	}
	if !strings.Contains(html, "这是一封测试邮件") || strings.Contains(html, "忽略这封邮件即可") {
		t.Error("测试邮件只应显示测试提示")
	}
}

// 参数不合法时在真正发信之前就拦下来
func TestSendTestEmailValidation(t *testing.T) {
	setupEditTest(t)
	svc := NewAdminService()

	if _, svcerr := svc.SendTestEmail(&dto.SendTestEmailReq{To: "admin@example.com"}); svcerr == nil || svcerr.Message != "email_not_configured" {
		t.Fatalf("未配置 SMTP 应报 email_not_configured，实际 %+v", svcerr)
	}
	if _, svcerr := svc.SendTestEmail(&dto.SendTestEmailReq{Host: "smtp.invalid", Port: 465}); svcerr == nil || svcerr.Message != "email_cannot_be_empty" {
		t.Fatalf("没有发件人地址应报错，实际 %+v", svcerr)
	}
	if _, svcerr := svc.SendTestEmail(&dto.SendTestEmailReq{Host: "smtp.invalid", Port: 465, Address: "bad"}); svcerr == nil || svcerr.Message != "invalid_email" {
		t.Fatalf("发件人格式无效应报 invalid_email，实际 %+v", svcerr)
	}
	if _, svcerr := svc.SendTestEmail(&dto.SendTestEmailReq{Host: "smtp.invalid", Port: 465, Address: "noreply@example.com", To: "not-an-email"}); svcerr == nil || svcerr.Message != "invalid_email" {
		t.Fatalf("收件人格式无效应报 invalid_email，实际 %+v", svcerr)
	}
	if _, svcerr := svc.SendTestEmail(&dto.SendTestEmailReq{Port: 465, Address: "noreply@example.com"}); svcerr == nil || svcerr.Code != http.StatusBadRequest {
		t.Fatalf("没有服务器地址应报错，实际 %+v", svcerr)
	}
}

// 请求体里的字段覆盖已保存的配置，供保存前先测试；缺的项取已保存的值
func TestResolveTestEmailConfig(t *testing.T) {
	setupEditTest(t)
	for key, value := range map[string]any{
		"email_host": "saved.smtp", "email_port": 587, "email_ssl": true,
		"email_username": "saved-user", "email_password": "saved-pass", "email_address": "saved@example.com",
		"email_enable": false,
	} {
		if err := repo.KV.SetKV(key, value); err != nil {
			t.Fatal(err)
		}
	}
	// 什么都不填：全部沿用已保存的配置，收件人默认是发件人自己
	config, to, svcerr := resolveTestEmailConfig(&dto.SendTestEmailReq{})
	if svcerr != nil {
		t.Fatalf("resolve: %+v", svcerr)
	}
	if config.Host != "saved.smtp" || config.Port != 587 || config.Username != "saved-user" || config.Password != "saved-pass" || config.Address != "saved@example.com" || to != "saved@example.com" {
		t.Fatalf("应沿用已保存的配置，实际 %+v to=%q", config, to)
	}
	// 测试不受「启用邮件发送」限制
	if !config.Enable {
		t.Error("测试邮件应强制启用发信")
	}
	// 填了的项覆盖已保存的配置；SSL 为 false 也是有效取值
	off := false
	config, to, svcerr = resolveTestEmailConfig(&dto.SendTestEmailReq{
		Host: " draft.smtp ", Port: 465, SSL: &off, Address: "draft@example.com", To: " admin@example.com ",
	})
	if svcerr != nil {
		t.Fatalf("resolve: %+v", svcerr)
	}
	if config.Host != "draft.smtp" || config.Port != 465 || config.SSL || config.Address != "draft@example.com" || to != "admin@example.com" {
		t.Fatalf("应使用表单里的取值，实际 %+v to=%q", config, to)
	}
	// 用户名、密码留空时沿用已保存的值
	if config.Username != "saved-user" || config.Password != "saved-pass" {
		t.Error("用户名与密码留空时应沿用已保存的值")
	}
}

// 发送失败时给出 failed_to_send_email（示例域名连不上），不泄漏底层细节到响应
func TestSendTestEmailSendFailure(t *testing.T) {
	setupEditTest(t)
	_, svcerr := NewAdminService().SendTestEmail(&dto.SendTestEmailReq{
		Host: "smtp.invalid", Port: 465, Address: "noreply@example.com", To: "admin@example.com",
	})
	if svcerr == nil || svcerr.Message != "failed_to_send_email" || svcerr.Code != http.StatusInternalServerError {
		t.Fatalf("应报发送失败，实际 %+v", svcerr)
	}
	if svcerr.Err == nil {
		t.Error("发送失败时应记录原始错误（只写日志）")
	}
}
