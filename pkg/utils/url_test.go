package utils

import "testing"

func TestIsValidUrl(t *testing.T) {
	validUrls := []string{
		"https://www.example.com",
		"http://example.com/path?query=param#fragment",
		"ftp://ftp.example.com/resource",
		"http://localhost:8080",
		"/api/v1/resource",
	}

	invalidUrls := []string{
		"://missing-scheme.com",
		"http//missing-colon.com",
		"just-a-string",
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
