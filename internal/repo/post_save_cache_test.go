package repo

import (
	"errors"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 保存文章 / 页面：只写草稿、保存失败（含草稿版本冲突）时不让前台缓存失效；写入公开字段或标签时失效
func TestContentSaveInvalidatesOnlyPublicChanges(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		sharedstate.UseMemory()
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		user := &model.User{Username: "save-cache", Email: "save-cache@example.com"}
		if err := User.CreateUser(user); err != nil {
			t.Fatal(err)
		}
		post := &model.Post{UserID: user.ID, PostBase: model.PostBase{Title: "post", Content: "<p>旧正文</p>"}}
		if err := Post.CreatePost(post); err != nil {
			t.Fatal(err)
		}
		page := &model.Page{UserID: user.ID, PageBase: model.PageBase{Title: "page", Slug: "save-cache-page"}}
		if err := Page.CreatePage(page); err != nil {
			t.Fatal(err)
		}

		// check 执行 write 后检查 tag 的版本号与访客缓存是否变化
		check := func(name, tag string, wantInvalidated bool, write func() error, wantErr error) {
			t.Helper()
			PostGuestCache.Set("probe", []byte("1"), time.Minute)
			before, _ := CacheTagVersions()
			err := write()
			if wantErr == nil && err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			if wantErr != nil && !errors.Is(err, wantErr) {
				t.Fatalf("%s: err = %v, want %v", name, err, wantErr)
			}
			after, _ := CacheTagVersions()
			if changed := after[tag] != before[tag]; changed != wantInvalidated {
				t.Fatalf("%s: %s tag changed = %v, want %v", name, tag, changed, wantInvalidated)
			}
			if tag == CacheTagPosts {
				_, kept := PostGuestCache.Get("probe")
				if kept == wantInvalidated {
					t.Fatalf("%s: guest cache kept = %v, want %v", name, kept, !wantInvalidated)
				}
			}
		}

		draft := "<p>草稿</p>"
		post.DraftContent = &draft
		check("post draft only", CacheTagPosts, false, func() error {
			return Post.SavePostWithDraftVersion(post, post.DraftVersion, []string{"draft_content"}, false)
		}, nil)
		check("post version conflict", CacheTagPosts, false, func() error {
			post.Content = "<p>冲突</p>"
			return Post.SavePostWithDraftVersion(post, post.DraftVersion+5, []string{"content"}, false)
		}, ErrDraftVersionConflict)
		check("post publish content", CacheTagPosts, true, func() error {
			post.Content = `<p>新<strong>正文</strong><span data-hdr="a>b">测试音频</span></p>`
			return Post.SavePostWithDraftVersion(post, post.DraftVersion, []string{"content", "draft_content"}, false)
		}, nil)
		check("post title", CacheTagPosts, true, func() error {
			post.Title = "新标题"
			return Post.SavePost(post, []string{"title"}, false)
		}, nil)
		check("post labels only", CacheTagPosts, true, func() error {
			return Post.SavePost(post, nil, true)
		}, nil)
		check("post nothing", CacheTagPosts, false, func() error {
			return Post.SavePost(post, nil, false)
		}, nil)

		// 发布正文时一并写入纯文本摘要，列表读到的是它而不是截断的 HTML
		items, _, err := Post.ListPosts(false, nil, &dto.ListPostReq{PaginationParams: dto.PaginationParams{Page: 1, Size: 10, OrderBy: "created_at"}})
		if err != nil || len(items) != 1 {
			t.Fatalf("list posts: %v %d", err, len(items))
		}
		if items[0].Excerpt != "新正文测试音频" || items[0].Content != "" {
			t.Fatalf("list excerpt = %q, content = %q", items[0].Excerpt, items[0].Content)
		}

		pageDraft := "<p>页面草稿</p>"
		page.DraftContent = &pageDraft
		check("page draft only", CacheTagPages, false, func() error {
			return Page.SavePageWithDraftVersion(page, page.DraftVersion, []string{"draft_content"})
		}, nil)
		check("page version conflict", CacheTagPages, false, func() error {
			return Page.SavePageWithDraftVersion(page, page.DraftVersion+5, []string{"content"})
		}, ErrDraftVersionConflict)
		check("page title", CacheTagPages, true, func() error {
			page.Title = "新页面标题"
			return Page.SavePage(page, []string{"title"})
		}, nil)
	})
}
