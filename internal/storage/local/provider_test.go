package local

import (
	"path/filepath"
	"testing"
)

func TestGetFullPathStaysInBaseDir(t *testing.T) {
	p := &LocalStorageProvider{baseDir: "/data/uploads"}
	for _, path := range []string{"../../etc/passwd", "ab/../../../etc/passwd", "/etc/passwd", "abcd/abcdef"} {
		full := p.getFullPath(path)
		if rel, err := filepath.Rel("/data/uploads", full); err != nil || rel == ".." || filepath.IsAbs(rel) || len(rel) >= 2 && rel[:2] == ".." {
			t.Fatalf("getFullPath(%q) = %q escapes base dir", path, full)
		}
	}
}
