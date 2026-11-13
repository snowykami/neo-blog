package utils

import (
	"net/url"
	"strings"
)

type urlUtils struct{}

var Url = &urlUtils{}

func (u *urlUtils) BuildUrl(baseUrl string, queryParams map[string]string) string {
	newUrl, err := url.Parse(baseUrl)
	if err != nil {
		return baseUrl
	}
	q := newUrl.Query()
	for key, value := range queryParams {
		q.Set(key, value)
	}
	newUrl.RawQuery = q.Encode()
	return newUrl.String()
}

// IsValidUrl 校验头像、封面、背景图等外部或站内资源地址：仅允许 http/https 完整地址或以单个 "/" 开头的站内相对路径
func (u *urlUtils) IsValidUrl(toTest string) bool {
	if toTest == "" || strings.TrimSpace(toTest) != toTest {
		return false
	}
	for _, r := range toTest {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	if strings.HasPrefix(toTest, "/") {
		if strings.HasPrefix(toTest, "//") || strings.Contains(toTest, "\\") {
			return false
		}
		_, err := url.ParseRequestURI(toTest)
		return err == nil
	}
	parsed, err := url.ParseRequestURI(toTest)
	if err != nil || parsed.Host == "" {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	return scheme == "http" || scheme == "https"
}
