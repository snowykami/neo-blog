package repo

import (
	"path/filepath"
	"testing"

	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestKVCacheReturnsIsolatedClones(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "kv.db"))
	if err := InitDatabase(); err != nil {
		t.Fatalf("init db: %v", err)
	}
	if err := KV.SetKV("site_info", map[string]any{
		"name": "orig",
		"nested": map[string]any{
			"theme": "light",
		},
	}); err != nil {
		t.Fatalf("set kv: %v", err)
	}

	first, err := KV.GetKV("site_info")
	if err != nil {
		t.Fatalf("get kv 1: %v", err)
	}
	m1 := first.(map[string]any)
	m1["name"] = "mutated"
	m1["nested"].(map[string]any)["theme"] = "dark"

	second, err := KV.GetKV("site_info")
	if err != nil {
		t.Fatalf("get kv 2: %v", err)
	}
	m2 := second.(map[string]any)
	if m2["name"] != "orig" || m2["nested"].(map[string]any)["theme"] != "light" {
		t.Fatalf("cached map was mutated in place: %#v", m2)
	}
}
