package config

import (
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
)

// MusicTTMLSource 自定义 TTML 歌词源：按列表顺序探测，先命中的采用（都排在 AMLL TTML DB 前面）。
// Name 显示在播放器的歌词来源标签上，为空时显示「自定义 TTML」；URL 含 {id}（或 {song_id}）时为地址模板，否则为目录前缀
type MusicTTMLSource struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// SongURL 这首歌在该源的地址：含 {id}（或 {song_id}）时替换为网易云歌曲 id（支持任意链接风格，
// 如 https://cdn.example.com/lyrics/{id}.ttml、https://example.com/ttml?id={id}），否则视为目录前缀，拼接为 {前缀}/{id}.ttml。
// 只接受 http(s) 绝对地址，无效时为空
func (s MusicTTMLSource) SongURL(id int64) string {
	songID := strconv.FormatInt(id, 10)
	raw := strings.TrimRight(s.URL, "/") + "/" + songID + ".ttml"
	if strings.Contains(s.URL, "{id}") || strings.Contains(s.URL, "{song_id}") {
		raw = strings.NewReplacer("{id}", songID, "{song_id}", songID).Replace(s.URL)
	}
	if u, err := url.Parse(raw); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	return raw
}

// decodeMusicTTMLSources 自定义 TTML 歌词源列表的校验与规整：去掉首尾空白与名称、地址都为空的项，地址无效时整体无效。
// 字符串为环境变量或旧数据：以 [ 开头时为 JSON 数组，否则是单个地址（视为一个没有名称的源）
func decodeMusicTTMLSources(raw any) (any, bool) {
	var items []any
	switch v := raw.(type) {
	case string:
		v = strings.TrimSpace(v)
		switch {
		case v == "":
		case strings.HasPrefix(v, "["):
			if json.Unmarshal([]byte(v), &items) != nil {
				return nil, false
			}
		default:
			items = []any{map[string]any{"url": v}}
		}
	case []MusicTTMLSource:
		for _, s := range v {
			items = append(items, map[string]any{"name": s.Name, "url": s.URL})
		}
	case []any:
		items = v
	default:
		return nil, false
	}
	sources := make([]MusicTTMLSource, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			return nil, false
		}
		name, _ := m["name"].(string)
		address, _ := m["url"].(string)
		source := MusicTTMLSource{Name: strings.TrimSpace(name), URL: strings.TrimSpace(address)}
		if source.Name == "" && source.URL == "" {
			continue
		}
		if source.SongURL(0) == "" {
			return nil, false
		}
		sources = append(sources, source)
	}
	return sources, true
}
