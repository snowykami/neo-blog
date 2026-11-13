package repo

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var db *gorm.DB

// ErrDatabaseNotInitialized 数据库尚未初始化时返回该错误，避免空指针解引用
var ErrDatabaseNotInitialized = errors.New("database is not initialized")

func GetDB() *gorm.DB {
	return db
}

// DB 返回绑定了请求上下文的数据库连接；客户端断开或超时后驱动可及时中止慢查询
func DB(ctx context.Context) *gorm.DB {
	if db == nil || ctx == nil {
		return db
	}
	return db.WithContext(ctx)
}

// Ping 检查数据库连接是否可用（就绪检查使用）
func Ping(ctx context.Context) error {
	d := GetDB()
	if d == nil {
		return ErrDatabaseNotInitialized
	}
	sqlDB, err := d.DB()
	if err != nil {
		return err
	}
	return sqlDB.PingContext(ctx)
}

// DBConfig 数据库连接配置：设置了 DB_URL 时完全由它决定，否则读取其他 DB_* 变量
type DBConfig struct {
	Driver string // 数据库驱动，"sqlite" 或 "postgres"
	DSN    string // PostgreSQL 连接串（URL 或 key=value）
	Path   string // SQLite 文件路径
	Params string // SQLite 附加连接参数（DB_URL 中 ? 之后的部分），追加在默认参数之后
	safe   string // 隐藏密码后的连接信息
}

// String 返回隐藏密码后的连接信息，打印配置时不会泄露密码
func (c DBConfig) String() string {
	return c.safe
}

// supportedDBURLs DB_URL 支持的格式，用于错误提示
const supportedDBURLs = "postgres://user:password@host:5432/dbname?sslmode=disable (or postgresql://), sqlite:///abs/path/blog.db, sqlite://./data/data.db, file:./data/data.db"

// LoadDBConfig 读取数据库配置：设置了 DB_URL 时以它为准，忽略其他 DB_* 变量
func LoadDBConfig() (DBConfig, error) {
	if raw := strings.TrimSpace(utils.Env.Get(constant.EnvKeyDBURL)); raw != "" {
		return parseDBURL(raw)
	}
	switch driver := utils.Env.Get(constant.EnvKeyDBDriver, "sqlite"); driver {
	case "postgres":
		safe := fmt.Sprintf("host=%s port=%d user=%s dbname=%s sslmode=%s",
			utils.Env.Get(constant.EnvKeyDBHost, "postgres"),
			utils.Env.GetAsInt(constant.EnvKeyDBPort, 5432),
			utils.Env.Get(constant.EnvKeyDBUser, "blog"),
			utils.Env.Get(constant.EnvKeyDBName, "blog"),
			utils.Env.Get(constant.EnvKeyDBSslMode, "disable"))
		dsn := safe + " password=" + utils.Env.Get(constant.EnvKeyDBPassword, "blog")
		return DBConfig{Driver: driver, DSN: dsn, safe: safe}, nil
	case "sqlite":
		path := utils.Env.Get(constant.EnvKeyDBPath, "./data/data.db")
		return DBConfig{Driver: driver, Path: path, safe: path}, nil
	default:
		return DBConfig{}, errors.New("unsupported database driver, only sqlite and postgres are supported")
	}
}

// parseDBURL 解析 DB_URL，驱动由 scheme 决定：Postgres 地址原样交给驱动；
// SQLite 地址去掉 scheme 后为文件路径（sqlite:///abs 为绝对路径，sqlite://./rel 与 file:./rel 为相对路径）
func parseDBURL(raw string) (DBConfig, error) {
	scheme, rest, _ := strings.Cut(raw, ":")
	switch scheme = strings.ToLower(scheme); scheme {
	case "postgres", "postgresql":
		dsn := scheme + ":" + rest // 驱动只认小写 scheme
		u, err := url.Parse(dsn)
		if err != nil {
			// url.Error 会带上完整地址（含密码），只保留原因
			var urlErr *url.Error
			if errors.As(err, &urlErr) {
				err = urlErr.Err
			}
			return DBConfig{}, fmt.Errorf("invalid %s: %w", constant.EnvKeyDBURL, err)
		}
		return DBConfig{Driver: "postgres", DSN: dsn, safe: redactURL(u)}, nil
	case "sqlite", "file":
		path, params, _ := strings.Cut(strings.TrimPrefix(rest, "//"), "?")
		if path == "" {
			return DBConfig{}, fmt.Errorf("%s is missing the SQLite file path, e.g. sqlite://./data/data.db", constant.EnvKeyDBURL)
		}
		return DBConfig{Driver: "sqlite", Path: path, Params: params, safe: path}, nil
	}
	// 只在能解析出合法 scheme 时回显，避免把误填的连接串（可能含密码）带进错误信息
	if u, err := url.Parse(raw); err == nil && u.Scheme != "" {
		return DBConfig{}, fmt.Errorf("unsupported %s scheme %q, supported formats: %s", constant.EnvKeyDBURL, u.Scheme, supportedDBURLs)
	}
	return DBConfig{}, fmt.Errorf("%s must start with a scheme, supported formats: %s", constant.EnvKeyDBURL, supportedDBURLs)
}

// redactURL 隐藏 URL 中的密码（用户信息与 password 参数）
func redactURL(u *url.URL) string {
	if q := u.Query(); q.Has("password") {
		q.Set("password", "xxxxx")
		u.RawQuery = q.Encode()
	}
	return u.Redacted()
}

// InitDatabase 手动初始化数据库连接
func InitDatabase() error {
	dbConfig, err := LoadDBConfig()
	if err != nil {
		return err
	}
	// 创建通用的 GORM 配置
	gormConfig := &gorm.Config{
		Logger:         newDBLogger(),
		TranslateError: true, // 统一数据库错误，便于识别唯一约束冲突（gorm.ErrDuplicatedKey）
	}

	activeDBConfig = dbConfig
	switch dbConfig.Driver {
	case "postgres":
		if db, err = initPostgres(dbConfig.DSN, gormConfig); err != nil {
			return fmt.Errorf("postgres initialization failed: %w", err)
		}
		logrus.Infoln("postgres initialization succeeded", dbConfig)
	case "sqlite":
		if db, err = initSQLite(dbConfig.Path, dbConfig.Params, gormConfig); err != nil {
			return fmt.Errorf("sqlite initialization failed: %w", err)
		}
		logrus.Infoln("sqlite initialization succeeded", dbConfig)
	}

	configureConnPool(dbConfig.Driver)
	KV.resetCache() // 切换数据库（如测试中重新初始化）时清空配置缓存
	resetQueryCaches()

	// 迁移模型
	if err = migrate(); err != nil {
		logrus.Error("Failed to migrate models:", err)
		return err
	}

	// 若一个储存提供者都没有，则在数据库中创建本地存储提供者的默认配置
	var providerCount int64
	err = db.Model(&model.StorageProviderModelAndDto{}).Count(&providerCount).Error
	if err != nil {
		return err
	}
	if providerCount == 0 {
		localProvider := &model.StorageProviderModelAndDto{
			Name:                  "Default Local Storage",
			Type:                  "local",
			IsDefault:             true,
			StorageProviderConfig: model.StorageProviderConfig{BaseDir: "./data/uploads"},
		}
		if err != nil {
			return err
		}
		err = db.Create(localProvider).Error
		if err != nil {
			return err
		}
	}
	return nil
}

// initPostgres 初始化PostgreSQL连接
func initPostgres(dsn string, gormConfig *gorm.Config) (*gorm.DB, error) {
	return gorm.Open(postgres.Open(dsn), gormConfig)
}

// initSQLite 初始化 SQLite 连接，params 追加在默认参数之后（同名 pragma 以它为准）
func initSQLite(path, params string, gormConfig *gorm.Config) (*gorm.DB, error) {
	if path == "" {
		path = "./data/data.db"
	}
	// 创建 SQLite 数据库文件的目录
	if err := os.MkdirAll(filepath.Dir(path), os.ModePerm); err != nil {
		return nil, fmt.Errorf("failed to create directory for SQLite database: %w", err)
	}
	// WAL 让读写互不阻塞，busy_timeout 避免并发写入时直接报 database is locked
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
	if params != "" {
		dsn += "&" + params
	}
	db, err := gorm.Open(sqlite.Open(dsn), gormConfig)
	return db, err
}

// newDBLogger 开发模式输出全部 SQL；生产只记录慢查询和错误，且忽略记录不存在
func newDBLogger() logger.Interface {
	level := logger.Warn
	if utils.IsDevMode {
		level = logger.Info
	}
	return logger.New(log.New(os.Stdout, "\r\n", log.LstdFlags), logger.Config{
		SlowThreshold:             200 * time.Millisecond,
		LogLevel:                  level,
		IgnoreRecordNotFoundError: true,
		Colorful:                  utils.IsDevMode,
	})
}

// configureConnPool 配置连接池；SQLite 写入本身串行，主要为 Postgres 设置
func configureConnPool(driver string) {
	sqlDB, err := db.DB()
	if err != nil {
		logrus.Warn("failed to get sql.DB: ", err)
		return
	}
	if driver == "postgres" {
		sqlDB.SetMaxOpenConns(20)
		sqlDB.SetMaxIdleConns(10)
		sqlDB.SetConnMaxLifetime(30 * time.Minute)
	}
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
}

// models 由 AutoMigrate 管理的全部模型
var models = []any{
	&model.AIAgent{},
	&model.AIAgentGroup{},
	&model.AgentMemory{},
	&model.AgentRelation{},
	&model.AgentRun{},
	&model.AIPrompt{},
	&model.APIToken{},
	&model.Comment{},
	&model.CommentTranslation{},
	&model.ContentRevision{},
	&model.EditSession{},
	&model.ErrorEvent{},
	&model.ErrorIssue{},
	&model.InteractionEvent{},
	&model.Label{},
	&model.Like{},
	&model.LLMUsage{},
	&model.LyricAnnotation{},
	&model.LyricCache{},
	&model.LyricSetting{},
	&model.LyricSongSetting{},
	&model.Notification{},
	&model.File{},
	&model.StorageProviderModelAndDto{},
	&model.KV{},
	&model.OidcConfig{},
	&model.Page{},
	&model.PageHTMLVersion{},
	&model.Post{},
	&model.Session{},
	&model.User{},
	&model.UserOpenID{},
	&model.Visitor{},
	&model.VisitLog{},
	&model.VisitEvent{},
}

// migrate 执行版本迁移与 AutoMigrate（见 runMigrations），再写入默认数据
func migrate() error {
	if err := runMigrations(); err != nil {
		return err
	}
	return seedDefaultAIPrompts()
}

// createQueryIndexes 为常用查询补充组合索引（gorm.Model 内的字段无法通过标签声明组合索引）
func createQueryIndexes() error {
	indexes := []string{
		// 文章列表：按可见性过滤后按时间或热度排序（2026110504 迁移删掉了旧的含 top 列的同名索引）
		"CREATE INDEX IF NOT EXISTS idx_posts_list_created ON posts (is_private, created_at)",
		"CREATE INDEX IF NOT EXISTS idx_posts_list_heat ON posts (is_private, heat)",
		// 评论列表：按目标与层级查询并按时间排序
		"CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target_type, target_id, depth, created_at)",
		// 文件按哈希查找与引用计数
		"CREATE INDEX IF NOT EXISTS idx_files_hash ON files (hash, provider_id)",
		// 按用户吊销、查询会话
		"CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)",
		// 访问去重：同一访客短时间内访问同一路径
		"CREATE INDEX IF NOT EXISTS idx_visit_logs_dedup ON visit_logs (visitor_id, path, created_at)",
		// 文章热度统计：按行为、目标类型与时间窗口扫描访问记录
		"CREATE INDEX IF NOT EXISTS idx_visit_logs_heat ON visit_logs (action, target_type, created_at, target_id)",
		// 标签关联反查：按 label_id 统计公开文章数与筛选文章（补充主键 (post_id, label_id) 的反向索引）
		"CREATE INDEX IF NOT EXISTS idx_post_labels_label_post ON post_labels (label_id, post_id)",
		// 通知：未读徽标与未读列表（read_at 为 NULL 时的等值查询走索引前缀）
		"CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, read_at, id)",
	}
	for _, sql := range indexes {
		if err := GetDB().Exec(sql).Error; err != nil {
			return err
		}
	}
	return nil
}
