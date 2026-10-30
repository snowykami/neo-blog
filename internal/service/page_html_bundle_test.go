package service

import (
	"archive/zip"
	"bytes"
	"io"
	"io/fs"
	"strings"
	"testing"
)

// zipEntry 测试用的 zip 条目；mode 为 0 时按普通文件写入
type zipEntry struct {
	name    string
	content string
	mode    fs.FileMode
}

func buildZip(t *testing.T, entries ...zipEntry) *bytes.Reader {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		header := &zip.FileHeader{Name: e.name, Method: zip.Deflate}
		if e.mode != 0 {
			header.SetMode(e.mode)
		}
		w, err := zw.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(w, e.content); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return bytes.NewReader(buf.Bytes())
}

var testLimits = pageHTMLLimits{MaxTotalSize: 1 << 20, MaxFiles: 10, MaxFileSize: 64 << 10}

func parseTestZip(t *testing.T, limits pageHTMLLimits, entries ...zipEntry) (*htmlBundle, *PageHTMLBundleError) {
	t.Helper()
	r := buildZip(t, entries...)
	return parseHTMLBundle("site.zip", r, r.Size(), limits)
}

func TestNormalizeBundlePath(t *testing.T) {
	valid := []string{"index.html", "assets/app.js", "a/b/c.css", "中文/页面.html", ".well-known/x.json", "my file.png"}
	for _, p := range valid {
		if got, ok := normalizeBundlePath(p); !ok || got != p {
			t.Errorf("normalizeBundlePath(%q) = %q, %v; want valid", p, got, ok)
		}
	}
	invalid := []string{
		"", "../evil.html", "a/../../evil.html", "a/../b.html", "/etc/passwd", "./index.html", "a/./b.html",
		"a//b.html", "a\\b.html", "..\\evil.html", "C:/evil.html", "C:evil.html", "a\x00b.html", "a\nb.html",
		"\xff\xfe.html", strings.Repeat("a/", 40) + "x.html", strings.Repeat("a", 600) + ".html",
	}
	for _, p := range invalid {
		if got, ok := normalizeBundlePath(p); ok {
			t.Errorf("normalizeBundlePath(%q) = %q; want rejected", p, got)
		}
	}
}

func TestParseHTMLBundleZip(t *testing.T) {
	// 压缩整个文件夹：去掉共同的顶层目录，跳过 macOS 元数据与目录条目
	bundle, err := parseTestZip(t, testLimits,
		zipEntry{name: "demo/", mode: fs.ModeDir | 0o755},
		zipEntry{name: "demo/index.html", content: "<h1>hi</h1>"},
		zipEntry{name: "demo/assets/app.js", content: "console.log(1)"},
		zipEntry{name: "demo/.DS_Store", content: "junk"},
		zipEntry{name: "__MACOSX/demo/._index.html", content: "junk"},
	)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	var paths []string
	for _, f := range bundle.Files {
		paths = append(paths, f.Path)
	}
	if got := strings.Join(paths, ","); got != "assets/app.js,index.html" {
		t.Fatalf("paths = %s", got)
	}
	if bundle.Entry != "index.html" {
		t.Fatalf("entry = %s", bundle.Entry)
	}
	rc, openErr := bundle.Files[1].open()
	if openErr != nil {
		t.Fatal(openErr)
	}
	data, _ := io.ReadAll(rc)
	_ = rc.Close()
	if string(data) != "<h1>hi</h1>" {
		t.Fatalf("content = %q", data)
	}
}

func TestParseHTMLBundleRejects(t *testing.T) {
	small := pageHTMLLimits{MaxTotalSize: 100, MaxFiles: 2, MaxFileSize: 60}
	cases := []struct {
		name    string
		limits  pageHTMLLimits
		entries []zipEntry
		code    string
		path    string
	}{
		{"traversal", testLimits, []zipEntry{{name: "index.html"}, {name: "../evil.html"}}, "page_html_invalid_path", "../evil.html"},
		{"nested traversal", testLimits, []zipEntry{{name: "a/../../evil.html"}}, "page_html_invalid_path", "a/../../evil.html"},
		{"absolute", testLimits, []zipEntry{{name: "/var/www/index.html"}}, "page_html_invalid_path", "/var/www/index.html"},
		{"backslash", testLimits, []zipEntry{{name: "..\\evil.html"}}, "page_html_invalid_path", "..\\evil.html"},
		{"drive letter", testLimits, []zipEntry{{name: "C:/evil.html"}}, "page_html_invalid_path", "C:/evil.html"},
		{"traversal dir entry", testLimits, []zipEntry{{name: "index.html"}, {name: "../", mode: fs.ModeDir | 0o755}}, "page_html_invalid_path", "../"},
		{"symlink", testLimits, []zipEntry{{name: "index.html"}, {name: "link.js", content: "/etc/passwd", mode: fs.ModeSymlink | 0o777}}, "page_html_unsupported_entry", "link.js"},
		{"named pipe", testLimits, []zipEntry{{name: "index.html"}, {name: "pipe.js", mode: fs.ModeNamedPipe | 0o644}}, "page_html_unsupported_entry", "pipe.js"},
		{"extension", testLimits, []zipEntry{{name: "index.html"}, {name: "shell.php"}}, "page_html_file_type_not_allowed", "shell.php"},
		{"no extension", testLimits, []zipEntry{{name: "index.html"}, {name: ".htaccess"}}, "page_html_file_type_not_allowed", ".htaccess"},
		{"file too large", small, []zipEntry{{name: "index.html", content: strings.Repeat("a", 61)}}, "page_html_file_too_large", "index.html"},
		{"bundle too large", small, []zipEntry{{name: "index.html", content: strings.Repeat("a", 60)}, {name: "a.js", content: strings.Repeat("a", 41)}}, "page_html_bundle_too_large", ""},
		{"too many files", small, []zipEntry{{name: "index.html"}, {name: "a.js"}, {name: "b.js"}}, "page_html_too_many_files", ""},
		{"case duplicate", testLimits, []zipEntry{{name: "index.html"}, {name: "INDEX.html"}}, "page_html_duplicate_file", "INDEX.html"},
		{"file and dir", testLimits, []zipEntry{{name: "index.html"}, {name: "a.js"}, {name: "a.js/b.js"}}, "page_html_duplicate_file", "a.js/b.js"},
		{"dir and file", testLimits, []zipEntry{{name: "index.html"}, {name: "a.js/b.js"}, {name: "a.js"}}, "page_html_duplicate_file", "a.js"},
		{"no html", testLimits, []zipEntry{{name: "app.js"}}, "page_html_entry_missing", ""},
		{"only junk", testLimits, []zipEntry{{name: ".DS_Store"}, {name: "__MACOSX/._x"}}, "page_html_empty_bundle", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := parseTestZip(t, c.limits, c.entries...)
			if err == nil {
				t.Fatalf("want %s, got nil", c.code)
			}
			if err.Code != c.code || err.Path != c.path {
				t.Fatalf("got %s (%q), want %s (%q)", err.Code, err.Path, c.code, c.path)
			}
		})
	}
}

func TestParseHTMLBundleSingleFileAndInvalidZip(t *testing.T) {
	html := strings.NewReader("<!doctype html><p>hi</p>")
	bundle, err := parseHTMLBundle("Demo.HTML", html, html.Size(), testLimits)
	if err != nil || len(bundle.Files) != 1 || bundle.Files[0].Path != "index.html" || bundle.Entry != "index.html" {
		t.Fatalf("single html: %+v %v", bundle, err)
	}
	big := strings.NewReader(strings.Repeat("a", int(testLimits.MaxFileSize)+1))
	if _, err := parseHTMLBundle("big.html", big, big.Size(), testLimits); err == nil || err.Code != "page_html_file_too_large" {
		t.Fatalf("big html: %v", err)
	}
	notZip := strings.NewReader("not a zip")
	if _, err := parseHTMLBundle("site.zip", notZip, notZip.Size(), testLimits); err == nil || err.Code != "page_html_invalid_zip" {
		t.Fatalf("invalid zip: %v", err)
	}
	if _, err := parseHTMLBundle("site.tar.gz", notZip, notZip.Size(), testLimits); err == nil || err.Code != "page_html_unsupported_upload" {
		t.Fatalf("unsupported upload: %v", err)
	}
}

func TestDefaultBundleEntry(t *testing.T) {
	files := func(paths ...string) []bundleFile {
		out := make([]bundleFile, 0, len(paths))
		for _, p := range paths {
			out = append(out, bundleFile{Path: p})
		}
		return out
	}
	cases := []struct {
		files []bundleFile
		want  string
	}{
		{files("about.html", "index.htm", "index.html"), "index.html"},
		{files("about.html", "index.htm"), "index.htm"},
		{files("a/b/deep.html", "game/play.html", "style.css"), "game/play.html"},
		{files("app.js"), ""},
	}
	for _, c := range cases {
		if got := defaultBundleEntry(c.files); got != c.want {
			t.Errorf("defaultBundleEntry(%v) = %q, want %q", c.files, got, c.want)
		}
	}
}

func TestPageHTMLContentType(t *testing.T) {
	cases := map[string]string{
		"index.HTML":      "text/html; charset=utf-8",
		"app.mjs":         "text/javascript; charset=utf-8",
		"wasm/game.wasm":  "application/wasm",
		"fonts/a.woff2":   "font/woff2",
		"img/logo.svg":    "image/svg+xml",
		"server.php":      "",
		"archive.zip":     "",
		"noext":           "",
		"app.js.map":      "application/json; charset=utf-8",
		"audio/theme.ogg": "audio/ogg",
	}
	for p, want := range cases {
		if got := PageHTMLContentType(p); got != want {
			t.Errorf("PageHTMLContentType(%q) = %q, want %q", p, got, want)
		}
	}
}
