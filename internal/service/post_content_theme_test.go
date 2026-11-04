package service

import (
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
)

func TestPostContentTheme(t *testing.T) {
	author, _, _, _, _ := setupEditTest(t)
	book, academic, unknown, empty := "book", "academic", "neon", ""

	id, svcerr := NewPostService().CreatePost(author, &dto.CreateOrUpdatePostReq{
		PostBaseDto:  dto.PostBaseDto{Title: "theme", Content: "<p>x</p>"},
		ContentTheme: &book,
	})
	if svcerr != nil {
		t.Fatalf("create post: %v", svcerr)
	}
	if got := reloadPost(t, id).ContentTheme; got != book {
		t.Fatalf("content theme should be %q, got %q", book, got)
	}

	update := func(theme *string) string {
		t.Helper()
		if _, svcerr := NewPostService().UpdatePost(author, &dto.CreateOrUpdatePostReq{ID: id, PostBaseDto: dto.PostBaseDto{Title: "theme"}, ContentTheme: theme}); svcerr != nil {
			t.Fatalf("update post: %v", svcerr)
		}
		return reloadPost(t, id).ContentTheme
	}
	// 未传时保持原值
	if got := update(nil); got != book {
		t.Fatalf("content theme should be kept when omitted, got %q", got)
	}
	if got := update(&academic); got != academic {
		t.Fatalf("content theme should be %q, got %q", academic, got)
	}
	// 不认识的主题与空字符串都表示跟随站点默认
	if got := update(&unknown); got != "" {
		t.Fatalf("unknown content theme should fall back to site default, got %q", got)
	}
	update(&book)
	if got := update(&empty); got != "" {
		t.Fatalf("empty content theme should follow site default, got %q", got)
	}
}
