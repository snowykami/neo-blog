package utils

import (
	"regexp"
	"strings"
	"time"
	_ "time/tzdata" // 容器镜像可能没有系统时区数据，内置一份，保证校验结果与运行环境无关
)

// timeZonePattern 标准时区名：UTC，或 IANA 时区数据库中「区域/地点」形式的名称，每段首字母大写
// （如 Asia/Shanghai、America/Argentina/Buenos_Aires、Etc/GMT-8）。
// 不接受 EST、PST8PDT 这类旧式缩写，也不接受 Local、posixrules 等不是时区的名称
var timeZonePattern = regexp.MustCompile(`^(?:UTC|[A-Z][A-Za-z]+(?:/[A-Z][A-Za-z0-9_+-]*){1,2})$`)

// timeZoneMaxLen 时区名的长度上限，最长的标准名称也不到 40 个字符
const timeZoneMaxLen = 64

// NormalizeTimeZone 去掉首尾空白后校验是否为标准 IANA 时区（格式符合且时区数据库中存在），返回规整后的名称
func NormalizeTimeZone(timeZone string) (string, bool) {
	timeZone = strings.TrimSpace(timeZone)
	if len(timeZone) > timeZoneMaxLen || !timeZonePattern.MatchString(timeZone) {
		return "", false
	}
	if _, err := time.LoadLocation(timeZone); err != nil {
		return "", false
	}
	return timeZone, true
}
