package repo

import (
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/model"
)

// 存储迁移与链接改写用到的文件查询在 SQLite 与 Postgres 上结果一致
func TestFileMigrationQueries(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		must := func(err error) {
			t.Helper()
			if err != nil {
				t.Fatal(err)
			}
		}
		hashA, hashB := strings.Repeat("a", 64), strings.Repeat("b", 64)
		files := []*model.File{
			{Hash: hashA, UserID: 1, ProviderID: 2, Size: 3},
			{Hash: hashA, UserID: 1, ProviderID: 2, Size: 3},
			{Hash: hashB, UserID: 1, ProviderID: 2, Size: 5},
			{Hash: hashB, UserID: 1, ProviderID: 3, Size: 5},
		}
		for _, f := range files {
			must(File.Create(f))
		}
		must(db.Create(&model.PageHTMLVersion{PageID: 1, Version: 1, Key: "k1", ProviderID: 2, Entry: "index.html"}).Error)

		ids, err := File.FirstIDsByHash(2, []string{hashA, hashB, "missing"})
		must(err)
		if len(ids) != 2 || ids[hashA] != files[0].ID || ids[hashB] != files[2].ID {
			t.Fatalf("first ids = %v", ids)
		}
		locs, err := File.ListLocations([]uint{files[0].ID, files[3].ID})
		must(err)
		if len(locs) != 2 || locs[0].Hash == "" || locs[0].ProviderID == 0 {
			t.Fatalf("locations = %+v", locs)
		}
		objects, err := File.ListStorageObjects(2, nil)
		must(err)
		if len(objects) != 2 || objects[0].Hash != hashA || objects[0].Size != 3 {
			t.Fatalf("objects = %+v", objects)
		}
		selected, err := File.ListStorageObjects(0, []uint{files[1].ID, files[3].ID})
		must(err)
		if len(selected) != 2 {
			t.Fatalf("selected objects = %+v", selected)
		}
		providers, err := File.ProviderIDsOfFiles([]uint{files[0].ID, files[3].ID})
		must(err)
		if len(providers) != 2 {
			t.Fatalf("providers = %v", providers)
		}

		usage, err := File.ListProviderUsage()
		must(err)
		if u := usage[2]; u.Files != 3 || u.Bytes != 11 || u.PageHTMLVersions != 1 {
			t.Fatalf("usage = %+v", usage)
		}
		must(File.MoveObject(objects[0], []uint{files[0].ID}, 3))
		must(File.MoveObject(objects[1], nil, 3))
		single, err := File.ProviderUsage(2)
		must(err)
		if single.Files != 1 || single.Bytes != 3 || !single.InUse() {
			t.Fatalf("usage after move = %+v", single)
		}

		// 改写文本列：含软删除的记录，可空列为 NULL 时跳过
		author := &model.User{Username: "u", Email: "u@test.local", AvatarUrl: "https://cdn.test/z"}
		must(db.Create(author).Error)
		post := &model.Post{UserID: author.ID, PostBase: model.PostBase{Title: "p", Content: `<img src="https://cdn.test/x">`, Cover: "https://cdn.test/y"}}
		must(db.Create(post).Error)
		must(db.Delete(post).Error)
		changed, err := File.RewriteFileLinkColumns([]string{"https://cdn.test/"}, func(s string) (string, bool) {
			next := strings.ReplaceAll(s, "https://cdn.test/", "/f/")
			return next, next != s
		})
		must(err)
		if changed != 2 {
			t.Fatalf("changed = %d", changed)
		}
		var got model.Post
		must(db.Unscoped().First(&got, post.ID).Error)
		if got.Content != `<img src="/f/x">` || got.Cover != "/f/y" || got.DraftContent != nil {
			t.Fatalf("post = %+v", got.PostBase)
		}
	})
}
