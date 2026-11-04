package repo

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/pkg/constant"
)

func TestParseDBURLPostgres(t *testing.T) {
	cases := []struct {
		raw     string
		wantDSN string
		wantLog string
	}{
		{
			raw:     "postgres://blog:s3cret@db.example.com:5432/blog?sslmode=disable",
			wantDSN: "postgres://blog:s3cret@db.example.com:5432/blog?sslmode=disable",
			wantLog: "postgres://blog:xxxxx@db.example.com:5432/blog?sslmode=disable",
		},
		{
			raw:     "postgresql://blog:s3cret@db:5432/blog",
			wantDSN: "postgresql://blog:s3cret@db:5432/blog",
			wantLog: "postgresql://blog:xxxxx@db:5432/blog",
		},
		{
			// 驱动只认小写 scheme
			raw:     "POSTGRES://blog:s3cret@db/blog",
			wantDSN: "postgres://blog:s3cret@db/blog",
			wantLog: "postgres://blog:xxxxx@db/blog",
		},
		{
			// 密码放在参数里同样隐藏
			raw:     "postgres://db/blog?user=blog&password=s3cret",
			wantDSN: "postgres://db/blog?user=blog&password=s3cret",
			wantLog: "postgres://db/blog?password=xxxxx&user=blog",
		},
	}
	for _, c := range cases {
		cfg, err := parseDBURL(c.raw)
		if err != nil {
			t.Fatalf("parseDBURL(%q): %v", c.raw, err)
		}
		if cfg.Driver != "postgres" || cfg.DSN != c.wantDSN {
			t.Errorf("parseDBURL(%q) = driver %q dsn %q, want postgres %q", c.raw, cfg.Driver, cfg.DSN, c.wantDSN)
		}
		if got := fmt.Sprint(cfg); got != c.wantLog {
			t.Errorf("parseDBURL(%q) log = %q, want %q", c.raw, got, c.wantLog)
		}
	}
}

func TestParseDBURLSQLite(t *testing.T) {
	cases := []struct {
		raw        string
		wantPath   string
		wantParams string
	}{
		{raw: "sqlite:///abs/path/blog.db", wantPath: "/abs/path/blog.db"},
		{raw: "sqlite://./data/data.db", wantPath: "./data/data.db"},
		{raw: "SQLite://data.db", wantPath: "data.db"},
		{raw: "file:./data/data.db", wantPath: "./data/data.db"},
		{raw: "file:///abs/blog.db", wantPath: "/abs/blog.db"},
		{raw: "sqlite://./data/data.db?_pragma=foreign_keys(1)", wantPath: "./data/data.db", wantParams: "_pragma=foreign_keys(1)"},
	}
	for _, c := range cases {
		cfg, err := parseDBURL(c.raw)
		if err != nil {
			t.Fatalf("parseDBURL(%q): %v", c.raw, err)
		}
		if cfg.Driver != "sqlite" || cfg.Path != c.wantPath || cfg.Params != c.wantParams {
			t.Errorf("parseDBURL(%q) = driver %q path %q params %q, want sqlite %q %q",
				c.raw, cfg.Driver, cfg.Path, cfg.Params, c.wantPath, c.wantParams)
		}
	}
}

func TestParseDBURLErrors(t *testing.T) {
	cases := []struct {
		raw  string
		want string
	}{
		{raw: "mysql://root:s3cret@db/blog", want: `unsupported DB_URL scheme "mysql"`},
		{raw: "./data/data.db", want: "DB_URL must start with a scheme"},
		// 误把 key=value 连接串填进 DB_URL 时不能回显密码
		{raw: "host=db user=blog password=s3cret:x", want: "DB_URL must start with a scheme"},
		{raw: "postgres://blog:s3cret@db:abc/blog", want: "invalid DB_URL"},
		{raw: "sqlite://", want: "missing the SQLite file path"},
	}
	for _, c := range cases {
		_, err := parseDBURL(c.raw)
		if err == nil {
			t.Fatalf("parseDBURL(%q) succeeded, want error", c.raw)
		}
		if !strings.Contains(err.Error(), c.want) {
			t.Errorf("parseDBURL(%q) error = %q, want containing %q", c.raw, err, c.want)
		}
		if strings.Contains(err.Error(), "s3cret") {
			t.Errorf("parseDBURL(%q) error leaks password: %q", c.raw, err)
		}
	}
}

func TestLoadDBConfigURLOverridesDBVars(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, "/tmp/ignored.db")
	t.Setenv(constant.EnvKeyDBURL, " postgres://blog:s3cret@db:5432/blog ")
	cfg, err := LoadDBConfig()
	if err != nil {
		t.Fatalf("LoadDBConfig: %v", err)
	}
	if cfg.Driver != "postgres" || cfg.DSN != "postgres://blog:s3cret@db:5432/blog" || cfg.Path != "" {
		t.Fatalf("LoadDBConfig = %+v, want postgres from DB_URL", cfg)
	}

	// 未设置 DB_URL 时沿用 DB_*
	t.Setenv(constant.EnvKeyDBURL, "")
	cfg, err = LoadDBConfig()
	if err != nil {
		t.Fatalf("LoadDBConfig: %v", err)
	}
	if cfg.Driver != "sqlite" || cfg.Path != "/tmp/ignored.db" {
		t.Fatalf("LoadDBConfig = %+v, want sqlite from DB_PATH", cfg)
	}
}

func TestLoadDBConfigLegacyPostgresHidesPassword(t *testing.T) {
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBDriver, "postgres")
	t.Setenv(constant.EnvKeyDBHost, "db")
	t.Setenv(constant.EnvKeyDBPort, "6543")
	t.Setenv(constant.EnvKeyDBUser, "blog")
	t.Setenv(constant.EnvKeyDBPassword, "s3cret")
	t.Setenv(constant.EnvKeyDBName, "blog")
	t.Setenv(constant.EnvKeyDBSslMode, "require")
	cfg, err := LoadDBConfig()
	if err != nil {
		t.Fatalf("LoadDBConfig: %v", err)
	}
	if want := "host=db port=6543 user=blog dbname=blog sslmode=require password=s3cret"; cfg.DSN != want {
		t.Errorf("DSN = %q, want %q", cfg.DSN, want)
	}
	if got := fmt.Sprintf("%v %+v %s", cfg, cfg, cfg); strings.Contains(got, "s3cret") {
		t.Errorf("printed config leaks password: %q", got)
	}

	t.Setenv(constant.EnvKeyDBDriver, "mysql")
	if _, err := LoadDBConfig(); err == nil {
		t.Error("LoadDBConfig with DB_DRIVER=mysql succeeded, want error")
	}
}

// TestInitDatabaseFromSQLiteURL DB_URL 指向 SQLite 时忽略指向 Postgres 的 DB_*，并应用 URL 中的连接参数
func TestInitDatabaseFromSQLiteURL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "blog.db")
	t.Setenv(constant.EnvKeyDBDriver, "postgres")
	t.Setenv(constant.EnvKeyDBHost, "unreachable.invalid")
	t.Setenv(constant.EnvKeyDBURL, "sqlite://"+path+"?_pragma=foreign_keys(1)")
	prev := db
	if err := InitDatabase(); err != nil {
		t.Fatalf("InitDatabase: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
		db = prev
	})
	if db.Dialector.Name() != "sqlite" {
		t.Fatalf("dialector = %q, want sqlite", db.Dialector.Name())
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("sqlite file not created: %v", err)
	}
	var foreignKeys int
	if err := db.Raw("PRAGMA foreign_keys").Scan(&foreignKeys).Error; err != nil {
		t.Fatalf("query pragma: %v", err)
	}
	if foreignKeys != 1 {
		t.Errorf("foreign_keys = %d, want 1 from DB_URL params", foreignKeys)
	}
}
