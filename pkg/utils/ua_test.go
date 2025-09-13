package utils

import "testing"

func TestParseUA(t *testing.T) {
	ua := "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"
	result := ParseUA(ua)
	if result.OS != "macOS" || result.OSVersion != "10.15.7" || result.Browser != "Edge" || result.BrowserVer != "140.0.0.0" {
		t.Errorf("ParseUA failed, got %+v", result)
	}
}
