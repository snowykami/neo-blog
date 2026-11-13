package model

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

func TestPostToDtoCollaboratorsNeverExposeEmail(t *testing.T) {
	showIP := true
	post := &Post{
		Model:  gorm.Model{ID: 10},
		UserID: 1,
		User: User{
			Model:    gorm.Model{ID: 1},
			Username: "author",
			Nickname: "Author",
			Email:    "author-secret@example.com",
			Role:     constant.RoleEditor,
		},
		Collaborators: []User{
			{
				Model:          gorm.Model{ID: 2},
				Username:       "collab1",
				Nickname:       "Collaborator One",
				AvatarUrl:      "https://example.com/a.png",
				Email:          "collab1-private@example.com",
				Role:           constant.RoleEditor,
				Language:       "zh",
				ShowIPLocation: &showIP,
				TimeZone:       "Asia/Shanghai",
				Disabled:       true,
				IsAI:           true,
			},
		},
		PostBase: PostBase{
			Title:   "Hello",
			Content: "<p>World</p>",
		},
	}

	got := post.ToDto()
	if len(got.Collaborators) != 1 {
		t.Fatalf("expected 1 collaborator, got %d", len(got.Collaborators))
	}
	if got.Collaborators[0].Username != "collab1" || got.Collaborators[0].Nickname != "Collaborator One" {
		t.Fatalf("unexpected collaborator public fields: %+v", got.Collaborators[0])
	}
	if got.Collaborators[0].GravatarHash == "" {
		t.Fatalf("expected gravatar_hash to be populated without exposing raw email")
	}

	rawJSON, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal PostDto: %v", err)
	}
	jsonStr := string(rawJSON)
	if strings.Contains(jsonStr, "collab1-private@example.com") || strings.Contains(jsonStr, "author-secret@example.com") {
		t.Fatalf("PostDto leaked email in JSON: %s", jsonStr)
	}
	if strings.Contains(jsonStr, `"email"`) {
		t.Fatalf("PostDto unexpectedly contains email key: %s", jsonStr)
	}
}
