package service

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
)

// 评论时间需输出 RFC 3339：刚创建的评论时间带单调时钟读数，旧的 time.Time.String() 会让前端得到 Invalid Date
func TestCommentDtoTimeIsRFC3339(t *testing.T) {
	created := time.Now() // 带单调时钟读数，与刚创建的评论一致
	comment := &model.Comment{}
	comment.CreatedAt = created
	comment.UpdatedAt = created.Add(time.Minute)

	data, err := json.Marshal(NewCommentService().toGetCommentDto(comment, false))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out struct {
		CreatedAt string `json:"created_at"`
		UpdatedAt string `json:"updated_at"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for name, value := range map[string]string{"created_at": out.CreatedAt, "updated_at": out.UpdatedAt} {
		parsed, err := time.Parse(time.RFC3339Nano, value)
		if err != nil {
			t.Fatalf("%s is not RFC 3339: %q", name, value)
		}
		want := comment.CreatedAt
		if name == "updated_at" {
			want = comment.UpdatedAt
		}
		if !parsed.Equal(want) {
			t.Fatalf("%s = %v, want %v", name, parsed, want)
		}
	}
}
