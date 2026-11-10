package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// 前端按路由作用域下发文案（web/scripts/i18n-scopes.mjs），配置页的文案键全部来自这里的声明，
// 前端源码里没有这些字符串。清单提交在 web/ 里，前端校验只读 web/ 下的文件（镜像构建上下文只有 web/）。
// 修改配置声明后运行 UPDATE_CONFIG_I18N_KEYS=1 go test ./internal/config/ 重新生成。
const configI18nKeysFile = "../../web/src/locales/config-keys.generated.json"

type configI18nKeys struct {
	Comment   string   `json:"//"`
	Namespace string   `json:"namespace"`
	Keys      []string `json:"keys"`
}

// configI18nKeyList 配置声明里所有作为 i18n 键使用的字段：页签标题、分组标题与说明、配置项名称 / 说明 / 占位文本、选项文案
func configI18nKeyList() []string {
	set := map[string]struct{}{}
	add := func(keys ...string) {
		for _, k := range keys {
			if k != "" {
				set[k] = struct{}{}
			}
		}
	}
	for _, tab := range tabs {
		add(tab.Title)
	}
	for _, section := range sections {
		add(section.Title, section.Description)
		for _, it := range section.Items {
			add(it.Label, it.Description, it.PlaceholderKey)
			for _, opt := range it.Options {
				add(opt.Label)
			}
		}
	}
	keys := make([]string, 0, len(set))
	for k := range set {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func TestConfigI18nKeysManifest(t *testing.T) {
	want := configI18nKeys{
		Comment:   "由 internal/config/i18n_keys_test.go 生成（UPDATE_CONFIG_I18N_KEYS=1 go test ./internal/config/），请勿手改",
		Namespace: "Console.global",
		Keys:      configI18nKeyList(),
	}
	path := filepath.FromSlash(configI18nKeysFile)

	if os.Getenv("UPDATE_CONFIG_I18N_KEYS") != "" {
		data, err := json.MarshalIndent(want, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取 %s 失败：%v（运行 UPDATE_CONFIG_I18N_KEYS=1 go test ./internal/config/ 生成）", configI18nKeysFile, err)
	}
	var got configI18nKeys
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("解析 %s 失败：%v", configI18nKeysFile, err)
	}
	if got.Namespace != want.Namespace || !slices.Equal(got.Keys, want.Keys) {
		t.Fatalf("%s 与配置声明不一致，运行 UPDATE_CONFIG_I18N_KEYS=1 go test ./internal/config/ 重新生成", configI18nKeysFile)
	}
}
