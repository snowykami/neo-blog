package service

import (
	"net/http"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 邮箱格式不对时直接拒绝，不去发信
func TestRequestVerifyEmailInvalidEmail(t *testing.T) {
	setupEditTest(t)
	for _, email := range []string{"bad-email", "a@", "Name <a@example.com>", ""} {
		_, svcerr := NewUserService().RequestVerifyEmail(&dto.VerifyEmailReq{Email: email, UserIP: "127.0.0.1"})
		if svcerr == nil || svcerr.Message != "invalid_email" || svcerr.Code != http.StatusBadRequest {
			t.Fatalf("%q 应报 invalid_email（400），实际 %+v", email, svcerr)
		}
	}
}

// 站点没有配置邮件服务：返回 4xx 业务错误（不进错误报告），且不占用冷却时间
func TestRequestVerifyEmailServiceUnavailable(t *testing.T) {
	setupEditTest(t)
	t.Setenv(constant.EnvKeyEmailEnable, "false")
	for i := 0; i < 2; i++ {
		_, svcerr := NewUserService().RequestVerifyEmail(&dto.VerifyEmailReq{Email: "someone@example.com", UserIP: "127.0.0.1"})
		if svcerr == nil || svcerr.Message != "email_service_unavailable" || svcerr.Code >= http.StatusInternalServerError {
			t.Fatalf("第 %d 次：未配置邮件服务应报 email_service_unavailable（4xx），实际 %+v", i+1, svcerr)
		}
	}
}

// 发信失败（SMTP 连不上）仍是后端问题（5xx），但不算一次发送：可以立即重试，不会被冷却拦成 too_many_requests
func TestRequestVerifyEmailSendFailureReleasesCoolDown(t *testing.T) {
	setupEditTest(t)
	t.Setenv(constant.EnvKeyEmailEnable, "true")
	t.Setenv(constant.EnvKeyEmailHost, "smtp.invalid")
	t.Setenv(constant.EnvKeyEmailPort, "465")
	t.Setenv(constant.EnvKeyEmailAddress, "noreply@example.com")
	for i := 0; i < 2; i++ {
		_, svcerr := NewUserService().RequestVerifyEmail(&dto.VerifyEmailReq{Email: "someone@example.com", UserIP: "127.0.0.1"})
		if svcerr == nil || svcerr.Message != "failed_to_send_email" {
			t.Fatalf("第 %d 次：发信失败应报 failed_to_send_email，实际 %+v", i+1, svcerr)
		}
	}
}

// 注册时邮箱格式不对直接拒绝
func TestUserRegisterInvalidEmail(t *testing.T) {
	setupEditTest(t)
	t.Setenv(constant.EnvKeyEnableRegister, "true")
	t.Setenv(constant.EnvKeyEnableEmailVerify, "false")
	_, svcerr := NewUserService().UserRegister(&dto.UserRegisterReq{Username: "newbie", Password: "password123", Email: "bad-email"})
	if svcerr == nil || svcerr.Message != "invalid_email" {
		t.Fatalf("注册邮箱格式无效应报 invalid_email，实际 %+v", svcerr)
	}
}
