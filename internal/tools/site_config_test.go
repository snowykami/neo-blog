package tools

import (
	"path/filepath"
	"testing"

	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
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
