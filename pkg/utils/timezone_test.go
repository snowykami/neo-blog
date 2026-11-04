package utils

import (
	"strings"
	"testing"
)

func TestNormalizeTimeZone(t *testing.T) {
	valid := map[string]string{
		"Asia/Shanghai":                  "Asia/Shanghai",
		" Asia/Tokyo ":                   "Asia/Tokyo",
		"UTC":                            "UTC",
		"Etc/UTC":                        "Etc/UTC",
		"Etc/GMT-8":                      "Etc/GMT-8",
		"America/Argentina/Buenos_Aires": "America/Argentina/Buenos_Aires",
		"America/Port-au-Prince":         "America/Port-au-Prince",
		"Asia/Calcutta":                  "Asia/Calcutta", // Chrome 上报的旧名称，仍是 IANA 链接
		"US/Eastern":                     "US/Eastern",
	}
	for input, want := range valid {
		if got, ok := NormalizeTimeZone(input); !ok || got != want {
			t.Errorf("NormalizeTimeZone(%q) = %q, %v; want %q", input, got, ok, want)
		}
	}
	invalid := []string{
		"", "  ", "Local", "EST", "PST8PDT", "GMT", "Factory", "posixrules", "UTC+8", "GMT+8", "北京时间",
		"Asia/tokyo", "asia/Tokyo", "Mars/Olympus", "Asia/Shanghai/", "/etc/passwd", "../../etc/passwd",
		"Asia/" + strings.Repeat("A", 64),
	}
	for _, input := range invalid {
		if got, ok := NormalizeTimeZone(input); ok {
			t.Errorf("NormalizeTimeZone(%q) = %q, want invalid", input, got)
		}
	}
}
