package repo

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

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
		Logger: logger.Default.LogMode(logger.Info),
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

	// 迁移模型
	if err = migrate(); err != nil {
		logrus.Error("Failed to migrate models:", err)
		return err
	}
	// TODO: impl
	//// 执行初始化数据
	//// 创建管理员账户
	//hashedPassword, err := utils.Password.HashPassword(config.AdminPassword, config.JwtSecret)
	//if err != nil {
	//	logrus.Error("Failed to hash password:", err)
	//	return err
	//}
	//user := &models.User{
	//	Name:     config.AdminUsername,
	//	Password: &hashedPassword,
	//	Role:     constants.GlobalRoleAdmin,
	//}
	//if err = User.UpdateSystemAdmin(user); err != nil {
	//	logrus.Error("Failed to update admin user:", err)
	//	return err
	//}
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
	db, err := gorm.Open(sqlite.Open(path), gormConfig)
	return db, err
}

func migrate() error {
	return GetDB().AutoMigrate(
		&model.Comment{},
		&model.Label{},
		&model.Like{},
		&model.File{},
		&model.KV{},
		&model.OidcConfig{},
		&model.Post{},
		&model.Session{},
		&model.User{},
		&model.UserOpenID{})
}
