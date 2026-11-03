package config

import (
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func setupDB(t *testing.T) {
	t.Helper()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	// 不受本机环境变量影响
	for _, it := range byKey {
		if it.Env != "" {
			t.Setenv(it.Env, "")
		}
	}
}

// 声明本身的一致性：后台表单依赖这些约定渲染
func TestDeclarations(t *testing.T) {
	tabKeys := make([]string, 0, len(tabs))
	for _, tab := range tabs {
		tabKeys = append(tabKeys, tab.Key)
	}
	for _, section := range sections {
		if !slices.Contains(tabKeys, section.Tab) || section.Title == "" || len(section.Items) == 0 {
			t.Errorf("section %q: bad tab, title or empty", section.Key)
		}
		for _, it := range section.Items {
			if it.Label == "" {
				t.Errorf("%s: missing label", it.Key)
			}
			// 默认值的类型与规整后的值一致（json 类型允许为空）
			if it.Default != nil {
				if v, ok := it.normalize(it.Default); !ok || !reflect.DeepEqual(v, it.Default) {
					t.Errorf("%s: default %#v does not match type %s", it.Key, it.Default, it.Type)
				}
				if !it.inRange(it.Default) {
					t.Errorf("%s: default out of range", it.Key)
				}
			} else if it.Type != TypeJSON {
				t.Errorf("%s: missing default", it.Key)
			}
			if (it.Type == TypeEnum) != (len(it.Options) > 0) && it.Type != TypeStringList {
				t.Errorf("%s: options only for enum / multi-select", it.Key)
			}
			if it.ShowWhen != nil && Lookup(it.ShowWhen.Key) == nil {
				t.Errorf("%s: show_when refers to unknown key %q", it.Key, it.ShowWhen.Key)
			}
			if (it.envCustom || it.EnvUnit != "") && it.Env == "" {
				t.Errorf("%s: env unit without env", it.Key)
			}
		}
	}
}

// 读取顺序：环境变量 > 后台配置 > 默认值；类型不符回退默认值，数字按范围截断
func TestRuntimeValues(t *testing.T) {
	setupDB(t)
	if got := Int("email_port"); got != 587 {
		t.Fatalf("default port = %d", got)
	}
	for key, value := range map[string]any{"email_port": float64(25), "site_name": 123, "revision_max_keep": 3, "captcha_provider": "nope", "color_schemes": []any{"blue", "gone"}} {
		if err := repo.KV.SetKV(key, value); err != nil {
			t.Fatal(err)
		}
	}
	if Int("email_port") != 25 || String("site_name") != "Snowykami's Blog" || Int("revision_max_keep") != RevisionMaxKeepMin {
		t.Fatalf("db values: port=%d name=%q keep=%d", Int("email_port"), String("site_name"), Int("revision_max_keep"))
	}
	// 单选不在可选值内时回退默认；多选去掉已下线的取值
	if String("captcha_provider") != constant.CaptchaTypeDisable || !reflect.DeepEqual(Strings("color_schemes"), []string{"blue"}) {
		t.Fatalf("enum / multi: %q %v", String("captcha_provider"), Strings("color_schemes"))
	}

	t.Setenv(constant.EnvKeyEmailPort, "465")
	t.Setenv(constant.EnvKeyEmailSsl, "yes") // 无法解析：按未设置处理
	t.Setenv(constant.EnvKeyCaptchaProvider, "typo")
	if Int("email_port") != 465 || !Bool("email_ssl") {
		t.Fatalf("env: port=%d ssl=%v", Int("email_port"), Bool("email_ssl"))
	}
	if _, ok := Lookup("email_ssl").EnvValue(); ok {
		t.Fatal("unparseable env should not be reported")
	}
	// 单选的环境变量写错时原样使用（人机验证会拒绝请求，而不是悄悄关闭）
	if String("captcha_provider") != "typo" {
		t.Fatalf("enum env = %q", String("captcha_provider"))
	}
	// 令牌有效期的环境变量单位为秒，通用读取不使用
	t.Setenv(constant.EnvKeyRefreshTokenDuration, "86400")
	if Int("refresh_token_days") != 7 {
		t.Fatalf("custom env leaked: %d", Int("refresh_token_days"))
	}
}

// site_info 中的配置先读 site_info，没有时读同名独立配置键（旧数据）
func TestSiteInfoValues(t *testing.T) {
	setupDB(t)
	if err := repo.KV.SetKV("owner_name", "legacy"); err != nil {
		t.Fatal(err)
	}
	if String("owner_name") != "legacy" {
		t.Fatalf("legacy fallback = %q", String("owner_name"))
	}
	if err := repo.KV.SetKV(siteInfoKey, map[string]any{"owner": map[string]any{"name": "Snowy"}, "default_cover": "https://a.png"}); err != nil {
		t.Fatal(err)
	}
	if String("owner_name") != "Snowy" || !reflect.DeepEqual(Strings("default_cover"), []string{"https://a.png"}) {
		t.Fatalf("site_info: %q %v", String("owner_name"), Strings("default_cover"))
	}
}

func TestSave(t *testing.T) {
	setupDB(t)
	// 未注册的键、类型不符、超出范围都拒绝
	for _, changes := range [][]Change{
		{{Key: "nope", Value: "x"}},
		{{Key: "email_port", Value: "25"}},
		{{Key: "email_port", Value: float64(70000)}},
		{{Key: "captcha_provider", Value: "nope"}},
	} {
		if err := Save(changes); err == nil {
			t.Fatalf("%v should be rejected", changes)
		}
	}
	// 启用人机验证必须有站点 Key 和密钥；密钥由环境变量提供时也算
	if err := Save([]Change{{Key: "captcha_provider", Value: "turnstile"}, {Key: "captcha_site_key", Value: "site"}}); err == nil || err.Message != "captcha_keys_required" {
		t.Fatalf("captcha check: %v", err)
	}
	t.Setenv(constant.EnvKeyCaptchaSecreteKey, "env-secret")
	if err := Save([]Change{{Key: "captcha_provider", Value: "turnstile"}, {Key: "captcha_site_key", Value: " site "}}); err != nil {
		t.Fatalf("captcha with env secret: %v", err)
	}
	if v, _ := repo.KV.GetKV("captcha_site_key"); v != "site" {
		t.Fatalf("trimmed site key = %v", v)
	}
	if _, err := repo.KV.GetKV("captcha_secret_key"); err == nil {
		t.Fatal("env value must not be written to the database")
	}

	// 还没有站点信息时按各项当前的值补全；同时写入独立配置键
	if err := Save([]Change{{Key: "site_name", Value: "Neo"}, {Key: "default_cover", Value: []any{"https://a.png", ""}}, {Key: "footer_links", Value: []any{map[string]any{"text": "", "href": ""}, map[string]any{"text": "Home", "href": "/"}}}}); err != nil {
		t.Fatal(err)
	}
	info, _ := repo.KV.GetKV(siteInfoKey)
	m := info.(map[string]any)
	if m["metadata"].(map[string]any)["name"] != "Neo" || m["posts_per_page"] != float64(10) || m["page_background"].(map[string]any)["veil"] != 0.72 {
		t.Fatalf("site_info = %v", m)
	}
	if links := m["footer"].(map[string]any)["links"].([]any); len(links) != 1 {
		t.Fatalf("empty links should be dropped: %v", links)
	}
	if v, _ := repo.KV.GetKV("site_name"); v != "Neo" {
		t.Fatalf("mirror site_name = %v", v)
	}
	if v, _ := repo.KV.GetKV("default_cover"); v != "https://a.png" {
		t.Fatalf("mirror default_cover = %v", v)
	}

	// 已有站点信息时只改对应路径，表单之外的字段保留
	m["sidebar_iframe_url"] = "https://keep.me"
	if err := repo.KV.SetKV(siteInfoKey, m); err != nil {
		t.Fatal(err)
	}
	if err := Save([]Change{{Key: "page_background_blur", Value: float64(8)}}); err != nil {
		t.Fatal(err)
	}
	info, _ = repo.KV.GetKV(siteInfoKey)
	m = info.(map[string]any)
	if m["sidebar_iframe_url"] != "https://keep.me" || m["page_background"].(map[string]any)["blur"] != float64(8) || m["metadata"].(map[string]any)["name"] != "Neo" {
		t.Fatalf("merge = %v", m)
	}
}

// 后台表单：数据库中的值与环境变量的值分开下发
func TestGetSchema(t *testing.T) {
	setupDB(t)
	if err := repo.KV.SetKV("email_host", "smtp.db.test"); err != nil {
		t.Fatal(err)
	}
	t.Setenv(constant.EnvKeyEmailHost, "smtp.env.test")
	schema := GetSchema()
	if len(schema.Tabs) != len(tabs) || len(schema.Sections) != len(sections) {
		t.Fatalf("schema size %d / %d", len(schema.Tabs), len(schema.Sections))
	}
	for _, section := range schema.Sections {
		for _, view := range section.Items {
			if view.Key == "email_host" && (view.Value != "smtp.db.test" || view.EnvValue != "smtp.env.test") {
				t.Fatalf("email_host view = %+v", view)
			}
		}
	}
}
