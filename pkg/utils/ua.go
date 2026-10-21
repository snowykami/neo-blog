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
	return r
}
