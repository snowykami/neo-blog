package config

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode"

	"github.com/snowykami/neo-blog/pkg/utils"
)

const misskeyMaxUsernameLen = 64

// NormalizeMisskeyInstanceURL 校验并规整 Misskey 实例根地址：
//   - 仅允许 80 / 443 端口的 http / https 公网地址（兼容代理 Fake-IP，拦截私网、回环、链路本地与云元数据）；
//   - 拒绝包含用户主页路径（如 /@username）或上级目录穿越的地址。
func NormalizeMisskeyInstanceURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("empty misskey instance url")
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("invalid url: %w", err)
	}
	if err := utils.CheckSafeURL(u, utils.SafeFetchAllowPrivate, utils.IsPublicOrFakeIPAddr); err != nil {
		return "", err
	}
	if port := u.Port(); port != "" && port != "80" && port != "443" && !utils.SafeFetchAllowPrivate {
		return "", utils.ErrBlockedAddress
	}
	cleanPath := strings.TrimRight(u.Path, "/")
	if strings.Contains(cleanPath, "..") || strings.Contains(cleanPath, "/@") || strings.HasPrefix(cleanPath, "@") {
		return "", errors.New("invalid misskey instance base path")
	}
	normalized := &url.URL{
		Scheme: strings.ToLower(u.Scheme),
		Host:   strings.ToLower(u.Host),
		Path:   cleanPath,
	}
	return strings.TrimRight(normalized.String(), "/"), nil
}

// NormalizeMisskeyUsername 规整本地 Misskey 用户名：去除单个前导 @，拒绝空白、控制字符、斜杠与远端 @host 注入
func NormalizeMisskeyUsername(raw string) (string, bool) {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "@")
	if s == "" || len(s) > misskeyMaxUsernameLen {
		return "", false
	}
	for _, r := range s {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return "", false
		}
		switch r {
		case '/', '\\', '?', '#', '@', '%', ':':
			return "", false
		}
	}
	return s, true
}
