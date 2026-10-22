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
