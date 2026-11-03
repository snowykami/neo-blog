package tools

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 后台全局配置保存的数字经 JSON 读出为 float64，读取时不能因类型断言 panic
func TestSiteConfigTypedValues(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	for key, value := range map[string]any{"max_reply_depth": 5, "enable_register": true, "site_name": 123} {
		if err := repo.KV.SetKV(key, value); err != nil {
			t.Fatalf("set %s: %v", key, err)
		}
	}
	if got := GetMaximumReplyDepth(); got != 5 {
		t.Errorf("GetMaximumReplyDepth() = %d, want 5", got)
	}
	if !GetAllowRegister() {
		t.Errorf("GetAllowRegister() = false, want true")
	}
	// 类型不符时回退默认值
	if got := GetSiteName(); got != "Snowykami's Blog" {
		t.Errorf("GetSiteName() = %q, want default", got)
	}
	// 未设置时使用默认值
	if !GetAllowRegisterFromOidc() {
		t.Errorf("GetAllowRegisterFromOidc() default should be true")
	}
}

// 和风天气 API Host：只保留 scheme 与 host，未写 scheme 时按 https，非 http(s) 时视为未配置
func TestNormalizeAPIHost(t *testing.T) {
	cases := map[string]string{
		"":                                   "",
		"abc123.re.qweatherapi.com":          "https://abc123.re.qweatherapi.com",
		" https://abc.qweatherapi.com/v7/x ": "https://abc.qweatherapi.com",
		"http://127.0.0.1:8080/path":         "http://127.0.0.1:8080",
		"ftp://abc.com":                      "",
		"javascript:alert(1)":                "",
	}
	for raw, want := range cases {
		if got := normalizeAPIHost(raw); got != want {
			t.Errorf("normalizeAPIHost(%q) = %q, want %q", raw, got, want)
		}
	}
}

// 令牌有效期：环境变量（秒）优先于后台配置（访问令牌按秒、刷新令牌按天），都没有时用默认值，超出范围取边界值
func TestGetAuthDurations(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	day := 24 * time.Hour
	if got := GetAuthDurations(); got != utils.DefaultJwtDurations {
		t.Fatalf("defaults = %+v", got)
	}
	if utils.DefaultJwtDurations.Access != 300*time.Second || utils.DefaultJwtDurations.Refresh != 7*day || utils.DefaultJwtDurations.RefreshRemember != 30*day {
		t.Fatalf("unexpected defaults %+v", utils.DefaultJwtDurations)
	}
	for key, value := range map[string]any{"token_duration": 600, "refresh_token_days": 2, "refresh_token_remember_days": 9999} {
		if err := repo.KV.SetKV(key, value); err != nil {
			t.Fatal(err)
		}
	}
	got := GetAuthDurations()
	if got.Access != 600*time.Second || got.Refresh != 2*day || got.RefreshRemember != 365*day {
		t.Fatalf("kv = %+v", got)
	}
	t.Setenv(constant.EnvKeyTokenDuration, "120")
	t.Setenv(constant.EnvKeyRefreshTokenDuration, "86400")
	if got := GetAuthDurations(); got.Access != 120*time.Second || got.Refresh != day {
		t.Fatalf("env should override kv: %+v", got)
	}
	// 后台显示环境变量的原值（秒）
	if env, _ := config.Lookup("refresh_token_days").EnvValue(); env != "86400" {
		t.Fatalf("env value = %q", env)
	}
}

// 人机验证与发信配置按注册表读取：环境变量优先于后台配置
func TestCaptchaAndEmailConfig(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	for _, key := range []string{constant.EnvKeyCaptchaProvider, constant.EnvKeyCaptchaSiteKey, constant.EnvKeyCaptchaSecreteKey, constant.EnvKeyEmailEnable, constant.EnvKeyEmailPort} {
		t.Setenv(key, "")
	}
	if got := GetCaptchaConfig(); got.Type != constant.CaptchaTypeDisable {
		t.Fatalf("default captcha = %+v", got)
	}
	for key, value := range map[string]any{"captcha_provider": "turnstile", "captcha_site_key": "db-site", "captcha_secret_key": "db-secret", "email_enable": true, "email_port": float64(25)} {
		if err := repo.KV.SetKV(key, value); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv(constant.EnvKeyCaptchaSecreteKey, "env-secret")
	t.Setenv(constant.EnvKeyEmailPort, "465")
	if got := GetCaptchaConfig(); *got != (utils.CaptchaConfig{Type: "turnstile", SiteKey: "db-site", SecretKey: "env-secret"}) {
		t.Fatalf("captcha = %+v", got)
	}
	if got := GetEmailConfig(); !got.Enable || got.Port != 465 || !got.SSL {
		t.Fatalf("email = %+v", got)
	}
}
