package service

import (
	"encoding/json"
	"os"
	"testing"
)

// mentionBoundaryCase 前后端共用的 @ 边界用例（web/src/utils/common/mention.test.ts 读同一个文件）
type mentionBoundaryCase struct {
	Name      string `json:"name"`
	Content   string `json:"content"`
	Username  string `json:"username"`
	Mentioned bool   `json:"mentioned"`
}

func TestMentionsUserBoundary(t *testing.T) {
	raw, err := os.ReadFile("testdata/mention_boundary_cases.json")
	if err != nil {
		t.Fatalf("read cases: %v", err)
	}
	var cases []mentionBoundaryCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("parse cases: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			if got := mentionsUser(c.Content, c.Username); got != c.Mentioned {
				t.Fatalf("mentionsUser(%q, %q) = %v, want %v", c.Content, c.Username, got, c.Mentioned)
			}
		})
	}
}
