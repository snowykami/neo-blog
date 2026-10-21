package utils

import (
	"net/url"
	"regexp"
	"strings"
)

// 访问来源分类
const (
	SourceDirect   = "direct"   // 直接访问：无来源（输入网址、书签，或来源网站/应用未传递来源）
	SourceInternal = "internal" // 站内跳转
	SourceExternal = "external" // 其他网站，具体域名见 host
)

// 常见来源：按域名识别，key 与前端的来源图标、名称对应
var knownSources = []struct {
	key     string
	pattern *regexp.Regexp
}{
	{"google", regexp.MustCompile(`(^|\.)google\.[a-z.]+$`)},
	{"bing", regexp.MustCompile(`(^|\.)bing\.com$`)},
	{"baidu", regexp.MustCompile(`(^|\.)baidu\.com$`)},
	{"duckduckgo", regexp.MustCompile(`(^|\.)duckduckgo\.com$`)},
	{"yandex", regexp.MustCompile(`(^|\.)yandex\.[a-z.]+$`)},
	{"yahoo", regexp.MustCompile(`(^|\.)yahoo\.[a-z.]+$`)},
	{"sogou", regexp.MustCompile(`(^|\.)sogou\.com$`)},
	{"so360", regexp.MustCompile(`(^|\.)so\.com$`)},
	{"github", regexp.MustCompile(`(^|\.)github\.com$`)},
	{"twitter", regexp.MustCompile(`(^|\.)(twitter\.com|x\.com|t\.co)$`)},
	{"weibo", regexp.MustCompile(`(^|\.)weibo\.(com|cn)$`)},
	{"zhihu", regexp.MustCompile(`(^|\.)zhihu\.com$`)},
	{"bilibili", regexp.MustCompile(`(^|\.)(bilibili\.com|b23\.tv)$`)},
	{"v2ex", regexp.MustCompile(`(^|\.)v2ex\.com$`)},
	{"reddit", regexp.MustCompile(`(^|\.)reddit\.com$`)},
	{"telegram", regexp.MustCompile(`(^|\.)(t\.me|telegram\.org)$`)},
	{"facebook", regexp.MustCompile(`(^|\.)(facebook\.com|fb\.com)$`)},
	{"linkedin", regexp.MustCompile(`(^|\.)(linkedin\.com|lnkd\.in)$`)},
	{"juejin", regexp.MustCompile(`(^|\.)juejin\.cn$`)},
	{"csdn", regexp.MustCompile(`(^|\.)csdn\.net$`)},
	{"chatgpt", regexp.MustCompile(`(^|\.)(chatgpt\.com|chat\.openai\.com)$`)},
	{"perplexity", regexp.MustCompile(`(^|\.)perplexity\.ai$`)},
	{"claude", regexp.MustCompile(`(^|\.)claude\.ai$`)},
}

func normalizeHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	if h, _, found := strings.Cut(host, ":"); found {
		host = h
	}
	return strings.TrimPrefix(host, "www.")
}

func matchKnownSource(host string) string {
	for _, s := range knownSources {
		if s.pattern.MatchString(host) {
			return s.key
		}
	}
	return ""
}

// classifyHost 按域名归类：站内、常见来源或其他网站
func classifyHost(host string, siteHosts []string) (source, normalized string) {
	host = normalizeHost(host)
	for _, site := range siteHosts {
		if site = normalizeHost(site); site != "" && host == site {
			return SourceInternal, host
		}
	}
	if key := matchKnownSource(host); key != "" {
		return key, host
	}
	return SourceExternal, host
}

// ClassifyReferrer 根据来源页面与访问路径中的 utm_source / ref 参数判断访问来源
// 返回来源分类与来源域名（直接访问时域名为空）
func ClassifyReferrer(referrer, path string, siteHosts ...string) (source, host string) {
	if u, err := url.Parse(strings.TrimSpace(referrer)); err == nil && u.Host != "" && (u.Scheme == "http" || u.Scheme == "https") {
		source, host = classifyHost(u.Host, siteHosts)
		// 站内跳转时仍以链接中的推广参数为准（如从站内落地页跳转前带入）
		if source != SourceInternal {
			return source, host
		}
	}

	// 没有来源页面时，尝试读取分享链接中的 utm_source / ref 参数（如 ?utm_source=github）
	if u, err := url.Parse(path); err == nil {
		query := u.Query()
		value := normalizeHost(query.Get("utm_source"))
		if value == "" {
			value = normalizeHost(query.Get("ref"))
		}
		if value != "" {
			value = Truncate(value, 128)
			if strings.Contains(value, ".") {
				return classifyHost(value, siteHosts)
			}
			for _, s := range knownSources {
				if s.key == value {
					return s.key, ""
				}
			}
			return SourceExternal, value
		}
	}
	if source == SourceInternal {
		return source, host
	}
	return SourceDirect, ""
}

// Truncate 按字节截断字符串（保证不截断多字节字符）
func Truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !isRuneStart(s[n]) {
		n--
	}
	return s[:n]
}

func isRuneStart(b byte) bool {
	return b&0xC0 != 0x80
}
