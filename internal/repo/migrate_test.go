package repo

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo/migrations"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// testPostgresDSNEnv 配置后额外在 Postgres 上跑迁移测试，需为 key=value 格式，如
// NEO_TEST_POSTGRES_DSN="host=localhost port=5432 user=blog password=blog dbname=blog sslmode=disable"
const testPostgresDSNEnv = "NEO_TEST_POSTGRES_DSN"

var migrationIDPattern = regexp.MustCompile(`^\d{10}_[a-z0-9_]+$`)

func TestMigrationIDs(t *testing.T) {
	prev := ""
	for _, m := range migrations.List() {
		if !migrationIDPattern.MatchString(m.ID) {
			t.Errorf("migration id %q should match YYYYMMDDNN_snake_case", m.ID)
		}
		if m.ID <= prev {
			t.Errorf("migration id %q should sort after %q", m.ID, prev)
		}
		prev = m.ID
	}
}

func TestMigrateFreshDatabase(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		want := append([]string{"SCHEMA_INIT"}, migrationIDs()...)
		assertAppliedMigrations(t, want)
		for _, value := range models {
			if !db.Migrator().HasTable(value) {
				t.Errorf("missing table for %T", value)
			}
		}
		if !db.Migrator().HasIndex(&model.Like{}, "idx_like_target_user") {
			t.Error("missing index idx_like_target_user")
		}
		if !db.Migrator().HasIndex(&model.Post{}, "idx_posts_list_created") {
			t.Error("missing index idx_posts_list_created")
		}

		// 再次启动不重复执行
		if err := migrate(); err != nil {
			t.Fatalf("migrate again: %v", err)
		}
		assertAppliedMigrations(t, want)
	})
}

func TestMigrateLegacyDatabase(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		seedLegacyDatabase(t)
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		assertAppliedMigrations(t, migrationIDs())

		var likeCount int64
		db.Unscoped().Model(&model.Like{}).Count(&likeCount)
		if likeCount != 1 {
			t.Errorf("likes = %d, want 1 after removing soft-deleted and duplicate likes", likeCount)
		}
		if !db.Migrator().HasIndex(&model.Like{}, "idx_like_target_user") {
			t.Error("missing index idx_like_target_user")
		}
		var posts []model.Post
		if err := db.Unscoped().Order("id").Find(&posts).Error; err != nil {
			t.Fatalf("list posts: %v", err)
		}
		wantLikes := map[uint]uint64{1: 1, 2: 0}
		for _, post := range posts {
			if post.LikeCount != wantLikes[post.ID] {
				t.Errorf("post %d like_count = %d, want %d", post.ID, post.LikeCount, wantLikes[post.ID])
			}
			if post.ContentHash != model.HashContent(post.Content) {
				t.Errorf("post %d content_hash = %q, want hash of content", post.ID, post.ContentHash)
			}
		}
		// 编辑过的保留 medium / slow；模型生成的改为跟随节拍（短语的节奏不变）；更早的数组记录转成对象
		wantPace := map[uint]struct {
			pace       string
			phrasePace string
		}{1: {pace: "medium"}, 2: {pace: "slow"}, 3: {phrasePace: "slow"}, 4: {pace: "medium"}}
		var annotations []model.LyricAnnotation
		if err := db.Order("id").Find(&annotations).Error; err != nil {
			t.Fatalf("list lyric annotations: %v", err)
		}
		for _, a := range annotations {
			var data struct {
				Pace  string `json:"pace"`
				Font  string `json:"font"`
				Lines []struct {
					Text    string `json:"text"`
					Phrases []struct {
						Pace string `json:"pace"`
					} `json:"phrases"`
				} `json:"lines"`
			}
			if err := json.Unmarshal([]byte(a.Data), &data); err != nil {
				t.Fatalf("annotation %d data %q: %v", a.ID, a.Data, err)
			}
			want := wantPace[a.ID]
			if data.Pace != want.pace {
				t.Errorf("annotation %d pace = %q, want %q", a.ID, data.Pace, want.pace)
			}
			if want.phrasePace != "" && data.Lines[0].Phrases[0].Pace != want.phrasePace {
				t.Errorf("annotation %d phrase pace = %q, want %q", a.ID, data.Lines[0].Phrases[0].Pace, want.phrasePace)
			}
		}
		if annotations[0].Data == "" || !json.Valid([]byte(annotations[0].Data)) {
			t.Errorf("annotation 1 data should stay valid JSON, got %q", annotations[0].Data)
		}
		if got := annotations[3].Data; !json.Valid([]byte(got)) {
			t.Errorf("legacy annotation should become an object, got %q", got)
		}
	})
}

func TestMigrateRejectsUnknownMigration(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		if err := db.Exec("INSERT INTO "+migrationTable+" (id) VALUES (?)", "2099010101_from_newer_version").Error; err != nil {
			t.Fatalf("insert unknown migration: %v", err)
		}
		if err := migrate(); !errors.Is(err, gormigrate.ErrUnknownPastMigration) {
			t.Fatalf("migrate with unknown migration error = %v, want ErrUnknownPastMigration", err)
		}
	})
}

// 多实例同时启动时由咨询锁串行执行；SQLite 只支持单实例，不测
func TestMigrateConcurrentStartup(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if db.Dialector.Name() != "postgres" {
			t.Skip("concurrent startup is only supported on postgres")
		}
		errs := make(chan error, 3)
		for range 3 {
			go func() { errs <- migrate() }()
		}
		for range 3 {
			if err := <-errs; err != nil {
				t.Fatalf("concurrent migrate: %v", err)
			}
		}
		assertAppliedMigrations(t, append([]string{"SCHEMA_INIT"}, migrationIDs()...))
	})
}

// seedLegacyDatabase 模拟引入版本迁移前的旧库：没有迁移记录，点赞表没有唯一索引且有重复点赞，文章表没有正文哈希列
func seedLegacyDatabase(t *testing.T) {
	t.Helper()
	if err := db.AutoMigrate(&model.User{}, &model.Post{}, &model.Comment{}, &model.Like{}, &model.LyricAnnotation{}); err != nil {
		t.Fatalf("create legacy tables: %v", err)
	}
	if err := db.Migrator().DropIndex(&model.Like{}, "idx_like_target_user"); err != nil {
		t.Fatalf("drop like index: %v", err)
	}
	if err := db.Migrator().DropColumn(&model.Post{}, "content_hash"); err != nil {
		t.Fatalf("drop content_hash: %v", err)
	}
	user := &model.User{Username: "legacy", Email: "legacy@test.local"}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	now := time.Now()
	statements := []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO posts (id, title, content, like_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", []any{1, "first", "hello", 5, now, now}},
		{"INSERT INTO posts (id, title, content, like_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", []any{2, "second", "world", 5, now, now}},
		{"INSERT INTO likes (target_type, target_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", []any{"post", 1, user.ID, now, now}},
		{"INSERT INTO likes (target_type, target_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", []any{"post", 1, user.ID, now, now}},
		{"INSERT INTO likes (target_type, target_id, user_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)", []any{"post", 2, user.ID, now, now, now}},
		// 歌词标注的全曲节奏：编辑过且为空（当时即 medium）、编辑过的 slow、模型生成的 fast、只有 lines 数组的更早的编辑记录
		{"INSERT INTO lyric_annotations (id, song_id, lyric_hash, data, created_at, edited_at) VALUES (?, ?, ?, ?, ?, ?)", []any{1, 1, "h1", `{"font":"kai","lines":[]}`, now, now}},
		{"INSERT INTO lyric_annotations (id, song_id, lyric_hash, data, created_at, edited_at) VALUES (?, ?, ?, ?, ?, ?)", []any{2, 2, "h2", `{"pace":"slow","lines":[]}`, now, now}},
		{"INSERT INTO lyric_annotations (id, song_id, lyric_hash, data, created_at) VALUES (?, ?, ?, ?, ?)", []any{3, 3, "h3", `{"pace":"fast","lines":[{"text":"心跳","phrases":[{"text":"心跳","effect":"heartbeat","pace":"slow"}]}]}`, now}},
		{"INSERT INTO lyric_annotations (id, song_id, lyric_hash, data, created_at, edited_at) VALUES (?, ?, ?, ?, ?, ?)", []any{4, 4, "h4", `[{"text":"旧"}]`, now, now}},
	}
	for _, s := range statements {
		if err := db.Exec(s.sql, s.args...).Error; err != nil {
			t.Fatalf("seed legacy data: %v", err)
		}
	}
}

func migrationIDs() []string {
	var ids []string
	for _, m := range migrations.List() {
		ids = append(ids, m.ID)
	}
	return ids
}

func assertAppliedMigrations(t *testing.T, want []string) {
	t.Helper()
	var got []string
	if err := db.Table(migrationTable).Order("id").Pluck("id", &got).Error; err != nil {
		t.Fatalf("list applied migrations: %v", err)
	}
	wantSet := make(map[string]bool, len(want))
	for _, id := range want {
		wantSet[id] = true
	}
	if len(got) != len(want) {
		t.Fatalf("applied migrations = %v, want %v", got, want)
	}
	for _, id := range got {
		if !wantSet[id] {
			t.Fatalf("applied migrations = %v, want %v", got, want)
		}
	}
}

// forEachDialect 分别在新建的 SQLite 库和独立 schema 的 Postgres 库（配置了 NEO_TEST_POSTGRES_DSN 时）上运行
func forEachDialect(t *testing.T, fn func(t *testing.T)) {
	t.Run("sqlite", func(t *testing.T) {
		d, err := initSQLite(filepath.Join(t.TempDir(), "test.db"), "", testGormConfig())
		if err != nil {
			t.Fatalf("open sqlite: %v", err)
		}
		useTestDB(t, d)
		fn(t)
	})
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv(testPostgresDSNEnv)
		if dsn == "" {
			t.Skipf("%s is not configured", testPostgresDSNEnv)
		}
		admin, err := gorm.Open(postgres.Open(dsn), testGormConfig())
		if err != nil {
			t.Fatalf("open postgres: %v", err)
		}
		schema := fmt.Sprintf("neo_migrate_test_%d", time.Now().UnixNano())
		if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
			t.Fatalf("create schema: %v", err)
		}
		t.Cleanup(func() {
			admin.Exec(`DROP SCHEMA "` + schema + `" CASCADE`)
			if sqlDB, err := admin.DB(); err == nil {
				_ = sqlDB.Close()
			}
		})
		d, err := gorm.Open(postgres.Open(dsn+" search_path="+schema), testGormConfig())
		if err != nil {
			t.Fatalf("open postgres schema: %v", err)
		}
		useTestDB(t, d)
		fn(t)
	})
}

func testGormConfig() *gorm.Config {
	return &gorm.Config{Logger: logger.Discard, TranslateError: true}
}

// useTestDB 把包级连接切换到测试库，结束后关闭并恢复
func useTestDB(t *testing.T, d *gorm.DB) {
	t.Helper()
	prev := db
	db = d
	t.Cleanup(func() {
		if sqlDB, err := d.DB(); err == nil {
			_ = sqlDB.Close()
		}
		db = prev
	})
}
