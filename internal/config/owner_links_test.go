package config

import (
	"reflect"
	"strings"
	"testing"
)

func TestDecodeOwnerLinks(t *testing.T) {
	valid := []struct {
		raw  any
		want []OwnerLink
	}{
		{"", []OwnerLink{}},
		{[]OwnerLink{}, []OwnerLink{}},
		{
			`[{"name":" Steam ","url":" https://steamcommunity.com/id/demo ","icon":"brand:steam"},{"name":"","url":""}]`,
			[]OwnerLink{{Name: "Steam", URL: "https://steamcommunity.com/id/demo", Icon: "brand:steam"}},
		},
		{
			[]any{
				map[string]any{"name": "GitHub", "url": "https://github.com/snowykami", "icon": "brand:github"},
				map[string]any{"name": "Mail", "url": "mailto:hi@example.com", "icon": "mail"},
				map[string]any{"name": "TG", "url": "tg://resolve?domain=demo", "icon": "brand:telegram"},
				map[string]any{"name": "QQ", "url": "tencent://message/?uin=10001", "icon": "brand:qq"},
				map[string]any{"name": "", "url": "/rss.xml", "icon": ""},
			},
			[]OwnerLink{
				{Name: "GitHub", URL: "https://github.com/snowykami", Icon: "brand:github"},
				{Name: "Mail", URL: "mailto:hi@example.com", Icon: "mail"},
				{Name: "TG", URL: "tg://resolve?domain=demo", Icon: "brand:telegram"},
				{Name: "QQ", URL: "tencent://message/?uin=10001", Icon: "brand:qq"},
				{Name: "", URL: "/rss.xml", Icon: "globe"},
			},
		},
	}
	for _, item := range valid {
		got, ok := decodeOwnerLinks(item.raw)
		if !ok || !reflect.DeepEqual(got, item.want) {
			t.Errorf("%#v: got %#v, %v, want %#v", item.raw, got, ok, item.want)
		}
	}

	tooMany := make([]any, 0, maxOwnerLinks+1)
	for range maxOwnerLinks + 1 {
		tooMany = append(tooMany, map[string]any{"url": "https://example.com", "icon": "globe"})
	}

	for _, raw := range []any{
		"https://github.com/snowykami",
		`[{"name":"GitHub","url":""}]`,
		[]any{map[string]any{"name": "XSS", "url": "javascript:alert(1)", "icon": "globe"}},
		[]any{map[string]any{"name": "Data", "url": "data:text/html,<script>", "icon": "globe"}},
		[]any{map[string]any{"name": "ProtoRel", "url": "//evil.example.com", "icon": "globe"}},
		[]any{map[string]any{"name": "BareHost", "url": "github.com/snowykami", "icon": "globe"}},
		[]any{map[string]any{"name": "Space", "url": "https://example.com/a b", "icon": "globe"}},
		[]any{map[string]any{"name": "BadIcon", "url": "https://example.com", "icon": "Brand_Invalid"}},
		[]any{map[string]any{"name": strings.Repeat("长", maxOwnerLinkNameRune+1), "url": "https://example.com", "icon": "globe"}},
		tooMany,
		42,
	} {
		if got, ok := decodeOwnerLinks(raw); ok {
			t.Errorf("%#v should be invalid, got %#v", raw, got)
		}
	}
}

func TestSaveOwnerLinks(t *testing.T) {
	setupDB(t)
	if err := Save([]Change{{Key: "owner_links", Value: []any{map[string]any{"name": "Bad", "url": "javascript:void(0)"}}}}); err == nil {
		t.Fatal("invalid owner_links should be rejected")
	}
	want := []OwnerLink{
		{Name: "Steam", URL: "https://steamcommunity.com/id/demo", Icon: "brand:steam"},
		{Name: "GitHub", URL: "https://github.com/snowykami", Icon: "brand:github"},
	}
	if err := Save([]Change{{Key: "owner_links", Value: []any{
		map[string]any{"name": "Steam", "url": "https://steamcommunity.com/id/demo", "icon": "brand:steam"},
		map[string]any{"name": "GitHub", "url": "https://github.com/snowykami", "icon": "brand:github"},
	}}}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if got := Value("owner_links"); !reflect.DeepEqual(got, want) {
		t.Fatalf("value = %#v, want %#v", got, want)
	}
	info := SiteInfo()
	owner, _ := info["owner"].(map[string]any)
	rawLinks, ok := owner["links"]
	if !ok {
		t.Fatalf("site_info.owner.links missing: %#v", info["owner"])
	}
	decoded, ok := decodeOwnerLinks(rawLinks)
	if !ok || !reflect.DeepEqual(decoded, want) {
		t.Fatalf("site_info.owner.links = %#v, want %#v", rawLinks, want)
	}
}
