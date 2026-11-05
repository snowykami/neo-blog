package repo

import (
	"context"
	"testing"
)

// 读取数据库运行统计：SQLite 只有版本与连接池；Postgres 读统计视图，包含连接、累计计数与库大小
func TestReadDatabaseStats(t *testing.T) {
	forEachDialect(t, func(t *testing.T) {
		if err := GetDB().Exec("SELECT 1").Error; err != nil {
			t.Fatal(err)
		}
		stats, err := ReadDatabaseStats(context.Background())
		if err != nil {
			t.Fatalf("read stats: %v", err)
		}
		if stats.Version == "" || stats.PoolOpen == 0 {
			t.Fatalf("stats = %+v", stats)
		}
		if stats.Driver == "postgres" {
			if stats.MaxConnections == 0 || stats.TotalConnections == 0 || stats.SizeBytes == 0 || stats.Counters.Commits == 0 || stats.Counters.BlocksHit == 0 {
				t.Fatalf("postgres stats = %+v", stats)
			}
		}
	})
}

// 连接位置不包含用户名与密码
func TestDBLocation(t *testing.T) {
	cases := map[string]DBConfig{
		"db.local:5432/blog": {Driver: "postgres", DSN: "postgres://user:secret@db.local:5432/blog?sslmode=disable"},
		"pg:5433/neo":        {Driver: "postgres", DSN: "host=pg port=5433 user=u password=secret dbname=neo sslmode=disable"},
		"./data/data.db":     {Driver: "sqlite", Path: "./data/data.db"},
	}
	for want, cfg := range cases {
		if got := dbLocation(cfg); got != want {
			t.Errorf("dbLocation(%+v) = %q, want %q", cfg, got, want)
		}
	}
}
