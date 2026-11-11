package utils

import (
	"regexp"
	"strings"
)

// 设备类型
const (
	DeviceDesktop = "desktop"
	DeviceMobile  = "mobile"
	DeviceTablet  = "tablet"
	DeviceBot     = "bot"
)

type UAResult struct {
	OS         string
	OSVersion  string
	Browser    string
	BrowserVer string
	DeviceType string // desktop / mobile / tablet / bot

	osVersionFrozen bool // OSVersion 是浏览器固定报的值，不代表真实系统版本（见 osVersionFrozen）
}

var (
	// 操作系统按顺序匹配：iOS/iPadOS 的 UA 含 "like Mac OS X"，Android 的 UA 含 "Linux"，需排在前面
	osPatterns = []struct {
		re     *regexp.Regexp
		os     string
		device string // 为空时按 UA 中是否含 Mobile 判断
	}{
		{regexp.MustCompile(`(?:HarmonyOS|OpenHarmony)[ /]?([\d.]*)`), "HarmonyOS", ""},
		{regexp.MustCompile(`iPad.*? OS ([\d_]+)`), "iPadOS", DeviceTablet},
		{regexp.MustCompile(`(?:iPhone|iPod).*? OS ([\d_]+)`), "iOS", DeviceMobile},
		{regexp.MustCompile(`Android ([\d.]+)`), "Android", ""},
		{regexp.MustCompile(`Windows NT ([\d.]+)`), "Windows", DeviceDesktop},
		{regexp.MustCompile(`Mac OS X ([\d_.]+)`), "macOS", DeviceDesktop},
		{regexp.MustCompile(`CrOS \S+ ([\d.]+)`), "ChromeOS", DeviceDesktop},
		{regexp.MustCompile(`Linux()`), "Linux", DeviceDesktop},
	}
	// 浏览器按优先级匹配：套壳浏览器的 UA 同时含 Chrome/Safari，需排在前面
	browserPatterns = []struct {
		re   *regexp.Regexp
		name string
	}{
		{regexp.MustCompile(`MicroMessenger/([\d.]+)`), "WeChat"},
		{regexp.MustCompile(`(?:MQQBrowser|QQBrowser)/([\d.]+)`), "QQ Browser"},
		{regexp.MustCompile(`UCBrowser/([\d.]+)`), "UC Browser"},
		{regexp.MustCompile(`SamsungBrowser/([\d.]+)`), "Samsung Internet"},
		{regexp.MustCompile(`(?:Edg|EdgA|EdgiOS)/([\d.]+)`), "Edge"},
		{regexp.MustCompile(`(?:OPR|OPiOS)/([\d.]+)`), "Opera"},
		{regexp.MustCompile(`(?:Firefox|FxiOS)/([\d.]+)`), "Firefox"},
		{regexp.MustCompile(`(?:Chrome|CriOS)/([\d.]+)`), "Chrome"},
		{regexp.MustCompile(`Version/([\d.]+).*Safari`), "Safari"},
	}
	botPattern = regexp.MustCompile(`(?i)bot|spider|crawl|slurp|headless|lighthouse|curl|wget|python-requests`)
)

// ParseUA 解析 UA，返回结构化信息
func ParseUA(ua string) UAResult {
	r := UAResult{DeviceType: DeviceDesktop}
	// 1. 操作系统 + 版本 + 设备类型
	for _, p := range osPatterns {
		if m := p.re.FindStringSubmatch(ua); m != nil {
			r.OS, r.OSVersion = p.os, strings.ReplaceAll(m[1], "_", ".")
			r.DeviceType = p.device
			if r.DeviceType == "" {
				r.DeviceType = DeviceTablet
				if strings.Contains(ua, "Mobile") {
					r.DeviceType = DeviceMobile
				}
			}
			break
		}
	}

	// 2. 浏览器 + 版本
	for _, b := range browserPatterns {
		if m := b.re.FindStringSubmatch(ua); len(m) > 1 {
			r.Browser, r.BrowserVer = b.name, m[1]
			break
		}
	}

	// 3. 爬虫与自动化工具
	if botPattern.MatchString(ua) {
		r.DeviceType = DeviceBot
	}
	r.osVersionFrozen = osVersionFrozen(r, ua)
	return r
}

// windowsReleases Windows NT 内核版本对应的发行名；NT 10.0 同时对应 Windows 10 与 11，无法区分，不在表中
var windowsReleases = map[string]string{
	"6.3": "8.1",
	"6.2": "8",
	"6.1": "7",
	"6.0": "Vista",
	"5.2": "XP",
	"5.1": "XP",
}

// osVersionFrozen UA 里的系统版本是否被浏览器固定成某个值、不代表真实版本
//   - macOS：Safari、Chrome、Firefox 都把 10.15 之后的系统固定报成 10.15(.7)
//   - Windows：NT 10.0 同时对应 Windows 10 与 11
//   - Android：Chrome 精简 UA 固定报 "Android 10; K"
//   - iOS / iPadOS：iOS 26 起 Safari 与 WebView 把系统版本固定报成 18.6
func osVersionFrozen(r UAResult, ua string) bool {
	switch r.OS {
	case "macOS":
		return strings.HasPrefix(r.OSVersion, "10.15")
	case "Windows":
		return r.OSVersion == "10.0"
	case "Android":
		return strings.Contains(ua, "Android 10; K)")
	case "iOS", "iPadOS":
		return r.OSVersion == "18.6"
	}
	return false
}

// PublicOS 对外展示的系统名与版本：版本被 UA 固定、无法反映真实系统时只给系统名，Windows 换成发行名
func (r UAResult) PublicOS() string {
	if r.OS == "" || r.OSVersion == "" || r.osVersionFrozen {
		return r.OS
	}
	version := r.OSVersion
	if r.OS == "Windows" {
		release, ok := windowsReleases[version]
		if !ok {
			return r.OS
		}
		version = release
	}
	return r.OS + " " + version
}

// PublicBrowser 对外展示的浏览器名与版本：去掉末尾的 .0（Chrome 精简 UA 只保留主版本，其余各段固定为 0）
func (r UAResult) PublicBrowser() string {
	if r.Browser == "" || r.BrowserVer == "" {
		return r.Browser
	}
	version := r.BrowserVer
	for strings.HasSuffix(version, ".0") {
		version = strings.TrimSuffix(version, ".0")
	}
	return r.Browser + " " + version
}
