package utils

import "testing"

func TestIsValidUrl(t *testing.T) {
	validUrls := []string{
		"https://www.example.com",
		"http://example.com/path?query=param#fragment",
		"http://localhost:8080",
		"/api/v1/resource",
		"/api/v1/file/f/12/cover.webp",
	}

	invalidUrls := []string{
		"",
		"://missing-scheme.com",
		"http//missing-colon.com",
		"just-a-string",
		"ftp://ftp.example.com/resource",
		"javascript:alert(1)",
		"JAVASCRIPT:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"vbscript:msgbox(1)",
		"//evil.example.com/payload",
		"/api/v1/file\\evil",
		"https://",
		"https://example.com/\nheader",
	}

	for _, url := range validUrls {
		if !Url.IsValidUrl(url) {
			t.Errorf("Expected URL to be valid: %s", url)
		}
	}

	for _, url := range invalidUrls {
		if Url.IsValidUrl(url) {
			t.Errorf("Expected URL to be invalid: %s", url)
		}
	}
}
