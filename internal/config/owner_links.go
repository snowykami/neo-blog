package config

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	maxOwnerLinks        = 24
	maxOwnerLinkNameRune = 64
	maxOwnerLinkURLLen   = 1024
	maxOwnerLinkIconLen  = 80
	defaultOwnerLinkIcon = "globe"
)

var ownerLinkIconPattern = regexp.MustCompile(`^(?:brand:)?[a-z0-9]+(?:-[a-z0-9]+)*$`)

// 允许用于站长个人链接的安全协议（除 http/https 与站内 / 相对路径外，兼容常见邮箱、电话与社交客户端唤起协议）
var allowedOwnerLinkSchemes = map[string]struct{}{
	"mailto":  {},
	"tel":     {},
	"sms":     {},
	"tg":      {},
	"tencent": {},
	"mqqapi":  {},
	"mqqwpa":  {},
	"weixin":  {},
	"steam":   {},
	"discord": {},
	"matrix":  {},
	"xmpp":    {},
	"nostr":   {},
	"irc":     {},
	"ircs":    {},
	"magnet":  {},
}

// OwnerLink 侧边栏「关于我」卡片中的站长社交 / 个人链接条目
type OwnerLink struct {
	Name string `json:"name,omitempty"`
	URL  string `json:"url"`
	Icon string `json:"icon"`
}

func isValidOwnerLinkURL(raw string) bool {
	if raw == "" || len(raw) > maxOwnerLinkURLLen {
		return false
	}
	for _, r := range raw {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return false
		}
	}
	// 站内相对地址（如 /rss.xml、/about、/api/v1/file/f/...），排除协议相对地址 //
	if strings.HasPrefix(raw, "/") {
		return !strings.HasPrefix(raw, "//")
	}
	colon := strings.IndexByte(raw, ':')
	if colon <= 0 {
		return false
	}
	scheme := strings.ToLower(raw[:colon])
	if scheme == "http" || scheme == "https" {
		u, err := url.Parse(raw)
		return err == nil && u.Host != ""
	}
	if _, ok := allowedOwnerLinkSchemes[scheme]; !ok {
		return false
	}
	rest := strings.TrimLeft(raw[colon+1:], "/")
	return rest != ""
}

func normalizeOwnerLinkIcon(raw string) (string, bool) {
	icon := strings.TrimSpace(raw)
	if icon == "" {
		return defaultOwnerLinkIcon, true
	}
	if len(icon) > maxOwnerLinkIconLen || !ownerLinkIconPattern.MatchString(icon) {
		return "", false
	}
	return icon, true
}

// decodeOwnerLinks 站长社交 / 个人链接列表的校验与规整：去掉首尾空白及完全空白的行，任何非空行地址或图标非法时整体拒绝
func decodeOwnerLinks(raw any) (any, bool) {
	var items []any
	switch v := raw.(type) {
	case string:
		v = strings.TrimSpace(v)
		if v != "" {
			if json.Unmarshal([]byte(v), &items) != nil {
				return nil, false
			}
		}
	case []OwnerLink:
		for _, item := range v {
			items = append(items, map[string]any{"name": item.Name, "url": item.URL, "icon": item.Icon})
		}
	case []map[string]any:
		for _, item := range v {
			items = append(items, item)
		}
	case []any:
		items = v
	default:
		return nil, false
	}

	links := make([]OwnerLink, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			return nil, false
		}
		name, _ := m["name"].(string)
		address, _ := m["url"].(string)
		iconRaw, _ := m["icon"].(string)
		name = strings.TrimSpace(name)
		address = strings.TrimSpace(address)
		if name == "" && address == "" {
			continue
		}
		if utf8.RuneCountInString(name) > maxOwnerLinkNameRune || !isValidOwnerLinkURL(address) {
			return nil, false
		}
		icon, ok := normalizeOwnerLinkIcon(iconRaw)
		if !ok {
			return nil, false
		}
		links = append(links, OwnerLink{Name: name, URL: address, Icon: icon})
		if len(links) > maxOwnerLinks {
			return nil, false
		}
	}
	return links, true
}
