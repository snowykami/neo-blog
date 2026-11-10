package v1

import (
	"slices"
	"testing"
)

// 候选歌曲 id 只接受正整数、最多 3 个；空串表示没有候选
func TestParseMusicTrackIDs(t *testing.T) {
	cases := []struct {
		raw  string
		want []int64
		ok   bool
	}{
		{"", nil, true},
		{"  ", nil, true},
		{"42", []int64{42}, true},
		{"1, 2,3", []int64{1, 2, 3}, true},
		{"1,2,3,4", nil, false},
		{"0", nil, false},
		{"-1", nil, false},
		{"1,abc", nil, false},
		{"1,,2", nil, false},
	}
	for _, tc := range cases {
		got, ok := parseMusicTrackIDs(tc.raw)
		if ok != tc.ok || !slices.Equal(got, tc.want) {
			t.Fatalf("parseMusicTrackIDs(%q) = %v, %v; want %v, %v", tc.raw, got, ok, tc.want, tc.ok)
		}
	}
}
