package repo

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo/migrations"
	"github.com/snowykami/neo-blog/pkg/constant"
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
		// 通知：两张新表与它们的唯一索引随建表创建
		for _, check := range []struct {
			value any
			index string
		}{
			{&model.InteractionEvent{}, "idx_interaction_event_dedupe"},
			{&model.Notification{}, "idx_notification_event_user"},
			{&model.Notification{}, "idx_notification_dedupe"},
		} {
			if !db.Migrator().HasTable(check.value) {
				t.Errorf("missing table for %T", check.value)
			}
			if !db.Migrator().HasIndex(check.value, check.index) {
				t.Errorf("missing index %s", check.index)
			}
		}
		if !db.Migrator().HasColumn(&model.User{}, "notification_prefs") {
			t.Error("missing column users.notification_prefs")
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
		// 旧库升级后同样补齐通知相关的新表、新列与唯一索引
		if !db.Migrator().HasTable(&model.InteractionEvent{}) || !db.Migrator().HasTable(&model.Notification{}) {
			t.Error("missing notification tables after upgrading a legacy database")
		}
		if !db.Migrator().HasIndex(&model.Notification{}, "idx_notification_dedupe") {
			t.Error("missing index idx_notification_dedupe")
		}
		if !db.Migrator().HasColumn(&model.User{}, "notification_prefs") {
			t.Error("missing column users.notification_prefs")
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
			// 纯文本摘要列按已发布正文回填（含软删除的文章）
			if post.Excerpt != model.PostExcerpt(post.Content) {
				t.Errorf("post %d excerpt = %q, want %q", post.ID, post.Excerpt, model.PostExcerpt(post.Content))
			}
			if post.ID == 5 && post.Excerpt != "测试音频 & 正文" {
				t.Errorf("post 5 excerpt = %q, want plain text", post.Excerpt)
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
		// 短语数列按已有的 Data 回填（后台列表不再读 Data）
		wantPhrases := map[uint]int{1: 0, 2: 0, 3: 1, 4: 0, 5: 3}
		for _, a := range annotations {
			if a.Phrases != wantPhrases[a.ID] {
				t.Errorf("annotation %d phrases = %d, want %d", a.ID, a.Phrases, wantPhrases[a.ID])
			}
		}
		// 单个自定义歌词源地址转为列表中一个没有名称的源，旧配置键删除
		var kvs []model.KV
		if err := db.Where("key LIKE ?", "music_ttml%").Order("key").Find(&kvs).Error; err != nil {
			t.Fatalf("list ttml config: %v", err)
		}
		if len(kvs) != 1 || kvs[0].Key != "music_ttml_sources" {
			t.Fatalf("ttml config = %+v, want only music_ttml_sources", kvs)
		}
		sources, _ := json.Marshal(kvs[0].Value["value"])
		if want := `[{"name":"","url":"https://cdn.example.com/lyrics/{song_id}.ttml"}]`; string(sources) != want {
			t.Errorf("music_ttml_sources = %s, want %s", sources, want)
		}
		// 系统写入的占位性别 unknown 改为不填，用户填写的内容原样保留
		wantGender := map[string]string{"legacy": "", "male": "male", "custom": "猫娘", "upper": "Unknown"}
		var users []model.User
		if err := db.Find(&users).Error; err != nil {
			t.Fatalf("list users: %v", err)
		}
		if len(users) != len(wantGender) {
			t.Fatalf("users = %d, want %d", len(users), len(wantGender))
		}
		for _, u := range users {
			if u.Gender != wantGender[u.Username] {
				t.Errorf("user %s gender = %q, want %q", u.Username, u.Gender, wantGender[u.Username])
			}
		}

		// 置顶级别最高的 3 篇转为置顶，级别越高置顶时间越晚；top 列与包含它的索引删除，列表索引按新定义重建
		if db.Migrator().HasColumn(&model.Post{}, "top") {
			t.Error("column top should be dropped")
		}
		if !db.Migrator().HasIndex(&model.Post{}, "idx_posts_list_created") || !db.Migrator().HasIndex(&model.Post{}, "PinnedAt") {
			t.Error("list index or pinned_at index missing after migration")
		}
		var pinned []model.Post
		if err := db.Unscoped().Where("pinned_at IS NOT NULL").Order("pinned_at DESC").Find(&pinned).Error; err != nil {
			t.Fatalf("list pinned posts: %v", err)
		}
		if got := []uint{}; len(pinned) > 0 {
			for _, p := range pinned {
				got = append(got, p.ID)
			}
			if fmt.Sprint(got) != "[3 4 2]" {
				t.Errorf("pinned posts = %v, want [3 4 2]", got)
			}
		} else {
			t.Error("no pinned posts after migration")
		}

		// 专业型旧的默认语气换成新的，其他字段保留；改过的语气不动
		var agents []model.AIAgent
		if err := db.Order("id").Find(&agents).Error; err != nil {
			t.Fatalf("list ai agents: %v", err)
		}
		if len(agents) != 2 {
			t.Fatalf("ai agents = %d, want 2", len(agents))
		}
		if p := agents[0].ParsedProfile(); p.Tone != "具体、直给，像懂行的网友顺手补一句，不说教" || p.Persona != "p" || len(p.Interests) != 1 {
			t.Errorf("default tone not migrated: %+v", p)
		}
		if p := agents[1].ParsedProfile(); p.Tone != "礼貌、具体，先肯定再补充，不说教。再加一句自己的要求" {
			t.Errorf("customised tone changed: %q", p.Tone)
		}
		// 新增的「评论里被 @」触发补进已有触发列表；没有 triggers 字段的档案不动
		if p := agents[0].ParsedProfile(); !slices.Contains(p.Triggers, constant.AgentTriggerCommentMentioned) || len(p.Triggers) != 4 {
			t.Errorf("mention trigger not appended: %v", p.Triggers)
		}
		if p := agents[1].ParsedProfile(); p.Triggers != nil {
			t.Errorf("profile without triggers should stay untouched: %v", p.Triggers)
		}

		// 通知补上最近活动时间与领取时间：普通行取创建时间，折叠行取 updated_at，卡在 sending 的行记下领取时间以便超时收回
		if !db.Migrator().HasIndex(&model.Notification{}, "idx_notification_user_activity") {
			t.Error("missing index idx_notification_user_activity")
		}
		var notifications []model.Notification
		if err := db.Order("id").Find(&notifications).Error; err != nil {
			t.Fatalf("list notifications: %v", err)
		}
		if len(notifications) != 3 {
			t.Fatalf("notifications = %d, want 3", len(notifications))
		}
		for _, n := range notifications {
			want := n.CreatedAt
			if n.AggregateCount > 0 {
				want = n.UpdatedAt
			}
			if !n.ActivityAt.Equal(want) {
				t.Errorf("notification %d activity_at = %v, want %v", n.ID, n.ActivityAt, want)
			}
			if (n.EmailState == "sending") != (n.EmailClaimedAt != nil) {
				t.Errorf("notification %d (%s) email_claimed_at = %v", n.ID, n.EmailState, n.EmailClaimedAt)
			}
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

// seedLegacyDatabase 模拟引入版本迁移前的旧库：没有迁移记录，点赞表没有唯一索引且有重复点赞，文章表没有正文哈希列，
// 自定义歌词源还是单个地址，用户性别里有建号时写入的 unknown
func seedLegacyDatabase(t *testing.T) {
	t.Helper()
	if err := db.AutoMigrate(&model.User{}, &model.Post{}, &model.Comment{}, &model.Like{}, &model.LyricAnnotation{}, &model.KV{}, &model.AIAgent{}); err != nil {
		t.Fatalf("create legacy tables: %v", err)
	}
	if err := db.Migrator().DropIndex(&model.Like{}, "idx_like_target_user"); err != nil {
		t.Fatalf("drop like index: %v", err)
	}
	if err := db.Migrator().DropColumn(&model.Post{}, "content_hash"); err != nil {
		t.Fatalf("drop content_hash: %v", err)
	}
	// 2026111130 之前没有纯文本摘要列
	if err := db.Migrator().DropColumn(&model.Post{}, "excerpt"); err != nil {
		t.Fatalf("drop excerpt: %v", err)
	}
	if err := db.Migrator().DropColumn(&model.LyricAnnotation{}, "phrases"); err != nil {
		t.Fatalf("drop lyric annotation phrases: %v", err)
	}
	// 旧的置顶级别 top（带索引，列表组合索引也包含它），还没有置顶时间与到期时间
	// SQLite 上前面删列会重建表，索引可能已经不在了
	if db.Migrator().HasIndex(&model.Post{}, "PinnedAt") {
		if err := db.Migrator().DropIndex(&model.Post{}, "PinnedAt"); err != nil {
			t.Fatalf("drop pinned_at index: %v", err)
		}
	}
	for _, column := range []string{"pinned_at", "pinned_until"} {
		if err := db.Migrator().DropColumn(&model.Post{}, column); err != nil {
			t.Fatalf("drop %s: %v", column, err)
		}
	}
	if err := db.Migrator().AddColumn(&legacyPost{}, "Top"); err != nil {
		t.Fatalf("add top: %v", err)
	}
	for _, sql := range []string{
		"CREATE INDEX idx_posts_top ON posts (top)",
		"CREATE INDEX idx_posts_list_created ON posts (is_private, top, created_at)",
		"CREATE INDEX idx_posts_list_heat ON posts (is_private, top, heat)",
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatalf("create legacy index: %v", err)
		}
	}
	user := &model.User{Username: "legacy", Email: "legacy@test.local", Gender: "unknown"}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	// 用户自己填写的性别：标准值、自定义文字、大小写不同的 Unknown
	for _, u := range []model.User{
		{Username: "male", Email: "male@test.local", Gender: "male"},
		{Username: "custom", Email: "custom@test.local", Gender: "猫娘"},
		{Username: "upper", Email: "upper@test.local", Gender: "Unknown"},
	} {
		if err := db.Create(&u).Error; err != nil {
			t.Fatalf("create user %s: %v", u.Username, err)
		}
	}
	now := time.Now()
	statements := []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO posts (id, title, content, like_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", []any{1, "first", "hello", 5, now, now}},
		{"INSERT INTO posts (id, title, content, like_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", []any{2, "second", "world", 5, now, now}},
		// 置顶级别：最高的 3 篇（同级别 id 大的在前）转为置顶，第 4 篇与已删除的不置顶
		{"UPDATE posts SET top = ? WHERE id = ?", []any{2, 2}},
		{"INSERT INTO posts (id, title, content, top, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", []any{3, "third", "c", 9, now, now}},
		{"INSERT INTO posts (id, title, content, top, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", []any{4, "fourth", "d", 2, now, now}},
		// 正文带属性里有 > 的标签：摘要回填为纯文本
		{"INSERT INTO posts (id, title, content, top, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", []any{5, "fifth", `<p><span data-hdr="a>b">测试音频</span> &amp; 正文</p>`, 1, now, now}},
		{"INSERT INTO posts (id, title, content, top, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)", []any{6, "deleted", "f", 5, now, now, now}},
		{"INSERT INTO likes (target_type, target_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", []any{"post", 1, user.ID, now, now}},
		{"INSERT INTO likes (target_type, target_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", []any{"post", 1, user.ID, now, now}},
		{"INSERT INTO likes (target_type, target_id, user_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)", []any{"post", 2, user.ID, now, now, now}},
		// 歌词标注的全曲节奏：编辑过且为空（当时即 medium）、编辑过的 slow、模型生成的 fast、只有 lines 数组的更早的编辑记录
		{"INSERT INTO lyric_annotations (id, song_id, lyric_hash, data, created_at, edited_at) VALUES (?, ?, ?, ?, ?, ?)", []any{1, 1, "h1", `{"font":"kai","lines":[]}`, now, now}},
		{"INSERT INTO lyric_annotations (id, song_id, lyric_hash, data, created_at, edited_at) VALUES (?, ?, ?, ?, ?, ?)", []any{2, 2, "h2", `{"pace":"slow","lines":[]}`, now, now}},
		{"INSERT INTO lyric_annotations (id, song_id, lyric_hash, data, created_at) VALUES (?, ?, ?, ?, ?)", []any{3, 3, "h3", `{"pace":"fast","lines":[{"text":"心跳","phrases":[{"text":"心跳","effect":"heartbeat","pace":"slow"}]}]}`, now}},
		{"INSERT INTO lyric_annotations (id, song_id, lyric_hash, data, created_at, edited_at) VALUES (?, ?, ?, ?, ?, ?)", []any{4, 4, "h4", `[{"text":"旧"}]`, now, now}},
		// 2026111120 之前没有短语数列：回填为各行短语的总数
		{"INSERT INTO lyric_annotations (id, song_id, lyric_hash, data, created_at) VALUES (?, ?, ?, ?, ?)", []any{5, 5, "h5", `{"lines":[{"text":"甲","phrases":[{"text":"甲","effect":"glow"}]},{"text":"乙丙","phrases":[{"text":"乙","effect":"swell"},{"text":"丙","effect":"wave"}]}]}`, now}},
	}
	for _, s := range statements {
		if err := db.Exec(s.sql, s.args...).Error; err != nil {
			t.Fatalf("seed legacy data: %v", err)
		}
	}
	seedLegacyNotifications(t, now)
	if err := db.Create(&model.KV{Key: "music_ttml_url_template", Value: model.JSONMap{"value": " https://cdn.example.com/lyrics/{song_id}.ttml "}}).Error; err != nil {
		t.Fatalf("seed legacy ttml config: %v", err)
	}
	// 专业型 AI 用户：一个还是旧的默认语气，一个是管理员改过的语气；
	// id=1 带着旧的触发方式列表（缺「评论里被 @」），id=2 没有 triggers 字段
	for _, agent := range []model.AIAgent{
		{ID: 1, UserID: 1, Tier: "expert", Profile: `{"persona":"p","tone":"礼貌、具体，先肯定再补充，不说教","interests":["Go"],"triggers":["browse","post.published","comment.replied"]}`},
		{ID: 2, UserID: 2, Tier: "expert", Profile: `{"tone":"礼貌、具体，先肯定再补充，不说教。再加一句自己的要求"}`},
	} {
		if err := db.Omit("User").Create(&agent).Error; err != nil {
			t.Fatalf("seed legacy ai agent: %v", err)
		}
	}
}

// seedLegacyNotifications 2026111101 之前的通知表：还没有 activity_at、email_claimed_at 与 (user_id, activity_at) 索引。
// 三行：普通行、updated_at 晚于创建时间的折叠行、卡在 sending 的行
func seedLegacyNotifications(t *testing.T, now time.Time) {
	t.Helper()
	if err := db.AutoMigrate(&model.InteractionEvent{}, &model.Notification{}); err != nil {
		t.Fatalf("create legacy notification tables: %v", err)
	}
	if db.Migrator().HasIndex(&model.Notification{}, "idx_notification_user_activity") {
		if err := db.Migrator().DropIndex(&model.Notification{}, "idx_notification_user_activity"); err != nil {
			t.Fatalf("drop activity index: %v", err)
		}
	}
	for _, column := range []string{"activity_at", "email_claimed_at"} {
		if err := db.Migrator().DropColumn(&model.Notification{}, column); err != nil {
			t.Fatalf("drop %s: %v", column, err)
		}
	}
	created := now.Add(-3 * time.Hour)
	updated := now.Add(-time.Hour)
	rows := []struct {
		id        uint
		aggregate int
		state     string
	}{
		{1, 0, "sent"},
		{2, 3, "attached"},
		{3, 0, "sending"},
	}
	for _, row := range rows {
		if err := db.Exec("INSERT INTO notifications (id, event_id, user_id, type, dedupe_key, aggregate_count, email_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			row.id, row.id, 1, "comment.created", fmt.Sprintf("legacy:%d", row.id), row.aggregate, row.state, created, updated).Error; err != nil {
			t.Fatalf("seed legacy notification: %v", err)
		}
	}
}

// legacyPost 置顶改版前的文章表里的置顶级别列
type legacyPost struct {
	Top uint `gorm:"default:0"`
}

func (legacyPost) TableName() string { return "posts" }

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

// 站点信息默认值改为中性占位：已保存过的站点信息里缺少的项（也没有同名独立配置键）补上旧默认值，保持现状；
// 已有的值、有独立配置键的项不动；从未保存过站点信息的库不新建
func TestMigrateSiteInfoOldDefaults(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		seedLegacyDatabase(t)
		info := map[string]any{
			"metadata": map[string]any{"name": "我的小站", "icon": "https://example.com/icon.png"},
			"owner":    map[string]any{"name": "站长"},
			"footer":   map[string]any{"links": []any{}},
		}
		for _, kv := range []model.KV{
			{Key: "site_info", Value: model.JSONMap{"value": info}},
			// 关于卡片背景存在独立配置键（旧数据），生效值以它为准，不补
			{Key: "about_background", Value: model.JSONMap{"value": ""}},
		} {
			if err := db.Create(&kv).Error; err != nil {
				t.Fatalf("seed %s: %v", kv.Key, err)
			}
		}
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		var row model.KV
		if err := db.Where("key = ?", "site_info").First(&row).Error; err != nil {
			t.Fatalf("load site_info: %v", err)
		}
		got, _ := json.Marshal(row.Value["value"])
		var saved struct {
			Metadata        map[string]any `json:"metadata"`
			Owner           map[string]any `json:"owner"`
			Footer          map[string]any `json:"footer"`
			DefaultCover    []string       `json:"default_cover"`
			AboutBackground *string        `json:"about_background"`
		}
		if err := json.Unmarshal(got, &saved); err != nil {
			t.Fatalf("parse site_info %s: %v", got, err)
		}
		if saved.Metadata["name"] != "我的小站" || saved.Metadata["icon"] != "https://example.com/icon.png" || saved.Owner["name"] != "站长" {
			t.Errorf("existing values changed: %s", got)
		}
		if saved.Owner["description"] != "A full-stack developer." || saved.Owner["avatar"] != "https://cdn.liteyuki.org/snowykami/avatar.jpg" {
			t.Errorf("missing owner fields not backfilled: %s", got)
		}
		if saved.Footer["text"] != "Liteyuki ICP 114514" || saved.Footer["links"] == nil {
			t.Errorf("footer = %v", saved.Footer)
		}
		if len(saved.DefaultCover) != 5 {
			t.Errorf("default_cover = %v", saved.DefaultCover)
		}
		if saved.AboutBackground != nil {
			t.Errorf("about_background has a standalone key and should not be backfilled: %q", *saved.AboutBackground)
		}
	})
}

// 音乐播放器只用网易云歌单：已保存的站点信息里的歌单来源与静态歌单地址删掉，同名独立配置键一并删除；
// 站点信息的其他项与网易云配置不动
func TestMigrateDropMusicStaticPlaylist(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		seedLegacyDatabase(t)
		info := map[string]any{
			"metadata":           map[string]any{"name": "我的小站"},
			"music_source":       "static",
			"music_playlist_url": "https://example.com/playlist.json",
		}
		for _, kv := range []model.KV{
			{Key: "site_info", Value: model.JSONMap{"value": info}},
			{Key: "music_playlist_url", Value: model.JSONMap{"value": "https://example.com/old.json"}},
			{Key: "ncm_playlist_id", Value: model.JSONMap{"value": 123}},
		} {
			if err := db.Create(&kv).Error; err != nil {
				t.Fatalf("seed %s: %v", kv.Key, err)
			}
		}
		if err := migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		var row model.KV
		if err := db.Where("key = ?", "site_info").First(&row).Error; err != nil {
			t.Fatalf("load site_info: %v", err)
		}
		saved, _ := row.Value["value"].(map[string]any)
		if _, ok := saved["music_source"]; ok {
			t.Errorf("music_source should be removed from site_info: %v", saved)
		}
		if _, ok := saved["music_playlist_url"]; ok {
			t.Errorf("music_playlist_url should be removed from site_info: %v", saved)
		}
		if metadata, _ := saved["metadata"].(map[string]any); metadata["name"] != "我的小站" {
			t.Errorf("other site_info fields changed: %v", saved)
		}
		var count int64
		db.Model(&model.KV{}).Where("key = ?", "music_playlist_url").Count(&count)
		if count != 0 {
			t.Errorf("standalone music_playlist_url should be deleted, count = %d", count)
		}
		db.Model(&model.KV{}).Where("key = ?", "ncm_playlist_id").Count(&count)
		if count != 1 {
			t.Errorf("ncm_playlist_id should be kept, count = %d", count)
		}
	})
}
