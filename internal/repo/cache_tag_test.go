package repo

import (
	"testing"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 前端缓存标签：从未变化过的标签不返回；文章、页面、用户、配置写入后对应标签换了版本号
func TestCacheTagVersions(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		sharedstate.UseMemory()
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		versions, err := CacheTagVersions()
		if err != nil || len(versions) != 0 {
			t.Fatalf("fresh state should have no versions: %v %v", versions, err)
		}
		changed := func(tag string, write func() error) {
			t.Helper()
			before, _ := CacheTagVersions()
			if err := write(); err != nil {
				t.Fatalf("write %s: %v", tag, err)
			}
			after, err := CacheTagVersions()
			if err != nil {
				t.Fatal(err)
			}
			if after[tag] == "" || after[tag] == before[tag] {
				t.Fatalf("%s version should change: %q -> %q", tag, before[tag], after[tag])
			}
		}
		user := &model.User{Username: "cache-tag", Email: "cache-tag@example.com"}
		changed(CacheTagUsers, func() error { return User.CreateUser(user) })
		changed(CacheTagUsers, func() error { return User.UpdateUserColumns(user.ID, map[string]any{"nickname": "n"}) })
		changed(CacheTagPosts, func() error {
			return Post.CreatePost(&model.Post{UserID: user.ID, PostBase: model.PostBase{Title: "post"}})
		})
		changed(CacheTagPages, func() error {
			return Page.CreatePage(&model.Page{UserID: user.ID, PageBase: model.PageBase{Title: "page", Slug: "cache-tag-page"}})
		})
		changed(CacheTagSite, func() error { return KV.SetKV("cache_tag_test", "v") })
	})
}
