package v1

import "testing"

func TestParseByteRange(t *testing.T) {
	cases := []struct {
		header     string
		start, end int64
		ok         bool
	}{
		{"bytes=0-99", 0, 99, true},
		{"bytes=100-", 100, 999, true},
		{"bytes=-200", 800, 999, true},
		{"bytes=900-5000", 900, 999, true},
		{"bytes=-5000", 0, 999, true},
		{"bytes=1000-", 0, 0, false},
		{"bytes=50-10", 0, 0, false},
		{"bytes=0-1,5-6", 0, 0, false},
		{"items=0-1", 0, 0, false},
	}
	for _, c := range cases {
		start, end, ok := parseByteRange(c.header, 1000)
		if ok != c.ok || (ok && (start != c.start || end != c.end)) {
			t.Errorf("parseByteRange(%q) = (%d, %d, %v), want (%d, %d, %v)", c.header, start, end, ok, c.start, c.end, c.ok)
		}
	}
}

func TestSniffAndGetContentType(t *testing.T) {
	fc := NewFileController()
	if got := fc.getContentType("favicon.ico"); got != "image/x-icon" {
		t.Fatalf("getContentType(favicon.ico) = %q, want image/x-icon", got)
	}
	if got := fc.getContentType("cover.avif"); got != "image/avif" {
		t.Fatalf("getContentType(cover.avif) = %q, want image/avif", got)
	}

	// ftypmif1 带 avif 兼容品牌 → image/avif；仅含 heic 品牌 → 不误判为 image/avif
	mif1Avif := []byte("\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00mif1avif")
	if got := sniffFileContentType(mif1Avif); got != "image/avif" {
		t.Fatalf("sniffFileContentType(mif1+avif) = %q, want image/avif", got)
	}
	mif1Heic := []byte("\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00mif1heic")
	if got := sniffFileContentType(mif1Heic); got == "image/avif" {
		t.Fatalf("sniffFileContentType(mif1+heic) should not be image/avif")
	}

	// 真实 ICO 魔数嗅探为 image/x-icon，而伪装成 .ico 的 HTML 嗅探为 text/html
	realIco := []byte{0x00, 0x00, 0x01, 0x00, 0x01, 0x00}
	if got := sniffFileContentType(realIco); got != "image/x-icon" {
		t.Fatalf("sniffFileContentType(realIco) = %q, want image/x-icon", got)
	}
	fakeIcoHtml := []byte("<!DOCTYPE html><script>alert(1)</script>")
	if got := sniffFileContentType(fakeIcoHtml); got != "text/html" {
		t.Fatalf("sniffFileContentType(fakeIcoHtml) = %q, want text/html", got)
	}
}
