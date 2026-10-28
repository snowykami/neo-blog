package repo

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
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

func GetDB() *gorm.DB {
	return db
}

// DBConfig 数据库配置结构体
type DBConfig struct {
	Driver   string // 数据库驱动类型，例如 "sqlite" 或 "postgres" Database driver type, e.g., "sqlite" or "postgres"
	Path     string // SQLite 路径 SQLite path
	Host     string // PostgreSQL 主机名 PostgreSQL hostname
	Port     int    // PostgreSQL 端口 PostgreSQL port
	User     string // PostgreSQL 用户名 PostgreSQL username
	Password string // PostgreSQL 密码 PostgreSQL password
	DBName   string // PostgreSQL 数据库名 PostgreSQL database name
	SSLMode  string // PostgreSQL SSL 模式 PostgreSQL SSL mode
}

// loadDBConfig 从配置文件加载数据库配置
func loadDBConfig() DBConfig {
	return DBConfig{
		Driver:   utils.Env.Get(constant.EnvKeyDBDriver, "sqlite"),
		Path:     utils.Env.Get(constant.EnvKeyDBPath, "./data/data.db"),
		Host:     utils.Env.Get(constant.EnvKeyDBHost, "postgres"),
		Port:     utils.Env.GetAsInt(constant.EnvKeyDBPort, 5432),
		User:     utils.Env.Get(constant.EnvKeyDBUser, "blog"),
		Password: utils.Env.Get(constant.EnvKeyDBPassword, "blog"),
		DBName:   utils.Env.Get(constant.EnvKeyDBName, "blog"),
		SSLMode:  utils.Env.Get(constant.EnvKeyDBSslMode, "disable"),
	}
}

// InitDatabase 手动初始化数据库连接
func InitDatabase() error {
	dbConfig := loadDBConfig()
	// 创建通用的 GORM 配置
	gormConfig := &gorm.Config{
		Logger:         newDBLogger(),
		TranslateError: true, // 统一数据库错误，便于识别唯一约束冲突（gorm.ErrDuplicatedKey）
	}

	var err error

	switch dbConfig.Driver {
	case "postgres":
		if db, err = initPostgres(dbConfig, gormConfig); err != nil {
			return fmt.Errorf("postgres initialization failed: %w", err)
		}
		logrus.Infoln("postgres initialization succeeded", dbConfig)
	case "sqlite":
		if db, err = initSQLite(dbConfig.Path, gormConfig); err != nil {
			return fmt.Errorf("sqlite initialization failed: %w", err)
		}
		logrus.Infoln("sqlite initialization succeeded", dbConfig)
	default:
		return errors.New("unsupported database driver, only sqlite and postgres are supported")
	}

	configureConnPool(dbConfig.Driver)
	KV.resetCache() // 切换数据库（如测试中重新初始化）时清空配置缓存

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
func initPostgres(config DBConfig, gormConfig *gorm.Config) (db *gorm.DB, err error) {
	if config.Host == "" || config.User == "" || config.Password == "" || config.DBName == "" {
		err = errors.New("PostgreSQL configuration is incomplete: host, user, password, and dbname are required")
	}
	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		config.Host, config.Port, config.User, config.Password, config.DBName, config.SSLMode)
	db, err = gorm.Open(postgres.Open(dsn), gormConfig)
	return
}

// initSQLite 初始化 SQLite 连接
func initSQLite(path string, gormConfig *gorm.Config) (*gorm.DB, error) {
	if path == "" {
		path = "./data/data.db"
	}
	// 创建 SQLite 数据库文件的目录
	if err := os.MkdirAll(filepath.Dir(path), os.ModePerm); err != nil {
		return nil, fmt.Errorf("failed to create directory for SQLite database: %w", err)
	}
	// WAL 让读写互不阻塞，busy_timeout 避免并发写入时直接报 database is locked
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
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
	}
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
}

func migrate() error {
	if err := prepareLikeUniqueIndex(); err != nil {
		return err
	}
	if err := GetDB().AutoMigrate(
		&model.AIPrompt{},
		&model.Comment{},
		&model.ContentRevision{},
		&model.EditSession{},
		&model.Label{},
		&model.Like{},
		&model.LyricAnnotation{},
		&model.LyricCache{},
		&model.File{},
		&model.StorageProviderModelAndDto{},
		&model.KV{},
		&model.OidcConfig{},
		&model.Page{},
		&model.Post{},
		&model.Session{},
		&model.User{},
		&model.UserOpenID{},
		&model.Visitor{},
		&model.VisitLog{}); err != nil {
		return err
	}
	if err := createQueryIndexes(); err != nil {
		return err
	}
	if err := seedDefaultAIPrompts(); err != nil {
		return err
	}
	return backfillPostContentHash()
}

// backfillPostContentHash 为升级前已有的文章补全正文哈希（AI 摘要过期判断依赖它）
func backfillPostContentHash() error {
	var posts []model.Post
	if err := GetDB().Unscoped().Select("id, content").Where("content_hash IS NULL OR content_hash = ''").Find(&posts).Error; err != nil {
		return err
	}
	for _, post := range posts {
		if err := GetDB().Unscoped().Model(&model.Post{}).Where("id = ?", post.ID).
			UpdateColumn("content_hash", model.HashContent(post.Content)).Error; err != nil {
			return err
		}
	}
	return nil
}

// createQueryIndexes 为常用查询补充组合索引（gorm.Model 内的字段无法通过标签声明组合索引）
func createQueryIndexes() error {
	indexes := []string{
		// 文章列表：按可见性过滤，置顶优先后按时间或热度排序
		"CREATE INDEX IF NOT EXISTS idx_posts_list_created ON posts (is_private, top, created_at)",
		"CREATE INDEX IF NOT EXISTS idx_posts_list_heat ON posts (is_private, top, heat)",
		// 评论列表：按目标与层级查询并按时间排序
		"CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target_type, target_id, depth, created_at)",
		// 文件按哈希查找与引用计数
		"CREATE INDEX IF NOT EXISTS idx_files_hash ON files (hash, provider_id)",
		// 按用户吊销、查询会话
		"CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)",
		// 访问去重：同一访客短时间内访问同一路径
		"CREATE INDEX IF NOT EXISTS idx_visit_logs_dedup ON visit_logs (visitor_id, path, created_at)",
	}
	for _, sql := range indexes {
		if err := GetDB().Exec(sql).Error; err != nil {
			return err
		}
	}
	return nil
}

// prepareLikeUniqueIndex 点赞表加唯一索引前，清理软删除记录和并发产生的重复点赞，并按实际记录修正计数
func prepareLikeUniqueIndex() error {
	db := GetDB()
	if !db.Migrator().HasTable(&model.Like{}) || db.Migrator().HasIndex(&model.Like{}, "idx_like_target_user") {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM likes WHERE deleted_at IS NOT NULL").Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM likes WHERE id NOT IN (SELECT MIN(id) FROM likes GROUP BY target_type, target_id, user_id)").Error; err != nil {
			return err
		}
		if err := tx.Exec("UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE likes.target_type = ? AND likes.target_id = posts.id)", "post").Error; err != nil {
			return err
		}
		return tx.Exec("UPDATE comments SET like_count = (SELECT COUNT(*) FROM likes WHERE likes.target_type = ? AND likes.target_id = comments.id)", "comment").Error
	})
}
