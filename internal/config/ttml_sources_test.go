package config

import (
	"reflect"
	"testing"
)

func TestMusicTTMLSourceSongURL(t *testing.T) {
	for _, item := range []struct{ url, want string }{
		{"https://cdn.example.com/lyrics/", "https://cdn.example.com/lyrics/42.ttml"},
		{"https://cdn.example.com/lyrics/{id}.ttml", "https://cdn.example.com/lyrics/42.ttml"},
		{"https://example.com/ttml?id={id}&format=ttml", "https://example.com/ttml?id=42&format=ttml"},
		{"https://cdn.liteyuki.org/snowykami/music/lyrics/{song_id}.ttml", "https://cdn.liteyuki.org/snowykami/music/lyrics/42.ttml"},
		{"ftp://example.com/{id}.ttml", ""},
		{"/lyrics/{id}.ttml", ""},
		{"cdn.example.com/lyrics", ""},
	} {
		if got := (MusicTTMLSource{URL: item.url}).SongURL(42); got != item.want {
			t.Errorf("%q: got %q, want %q", item.url, got, item.want)
		}
	}
}

// 后台保存的列表、环境变量（单个地址或 JSON 数组）都规整为同一种列表；地址无效时整体无效
func TestDecodeMusicTTMLSources(t *testing.T) {
	valid := []struct {
		raw  any
		want []MusicTTMLSource
	}{
		{"", []MusicTTMLSource{}},
		{" https://a.example.com/{id}.ttml ", []MusicTTMLSource{{URL: "https://a.example.com/{id}.ttml"}}},
		{`[{"name":" 甲 ","url":"https://a.example.com/"},{"name":"","url":""}]`, []MusicTTMLSource{{Name: "甲", URL: "https://a.example.com/"}}},
		{[]any{map[string]any{"name": "乙", "url": "https://b.example.com/{song_id}.ttml"}}, []MusicTTMLSource{{Name: "乙", URL: "https://b.example.com/{song_id}.ttml"}}},
		{[]MusicTTMLSource{}, []MusicTTMLSource{}},
	}
	for _, item := range valid {
		got, ok := decodeMusicTTMLSources(item.raw)
		if !ok || !reflect.DeepEqual(got, item.want) {
			t.Errorf("%#v: got %#v, %v", item.raw, got, ok)
		}
	}
	for _, raw := range []any{
		"cdn.example.com/lyrics",
		`[{"name":"甲"}]`,
		`[{"name":"甲",`,
		[]any{map[string]any{"name": "甲", "url": "ftp://a.example.com/"}},
		[]any{"https://a.example.com/"},
		42,
	} {
		if got, ok := decodeMusicTTMLSources(raw); ok {
			t.Errorf("%#v should be invalid, got %#v", raw, got)
		}
	}
}

// 保存时校验：地址无效的列表被拒绝
func TestSaveMusicTTMLSources(t *testing.T) {
	setupDB(t)
	if err := Save([]Change{{Key: "music_ttml_sources", Value: []any{map[string]any{"name": "甲", "url": "not a url"}}}}); err == nil {
		t.Fatal("invalid source should be rejected")
	}
	if err := Save([]Change{{Key: "music_ttml_sources", Value: []any{map[string]any{"name": "甲", "url": "https://a.example.com/{id}.ttml"}}}}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if got := Value("music_ttml_sources"); !reflect.DeepEqual(got, []MusicTTMLSource{{Name: "甲", URL: "https://a.example.com/{id}.ttml"}}) {
		t.Fatalf("value = %#v", got)
	}
}
