package repo

import (
	"context"
	"fmt"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo/migrations"
	"gorm.io/gorm"
)

const (
	// migrationTable 记录已执行版本迁移的表
	migrationTable = "schema_migrations"
	// migrationLockKey Postgres 咨询锁的键，多实例同时启动时串行执行迁移
	migrationLockKey int64 = 0x6e656f626c6f67 // "neoblog"
)

// runMigrations 先执行未执行的版本迁移，再由 AutoMigrate 补齐纯增量的表、列和索引
//   - 全新库：直接按最新模型建表，并把全部版本迁移标记为已执行
//   - 旧库（有表但没有迁移记录）：从第一条版本迁移开始执行
//   - 已记录版本的库：只执行未执行的版本迁移；库中有当前代码不认识的迁移（如回退到旧版本）时拒绝启动
func runMigrations() error {
	unlock, err := lockMigration()
	if err != nil {
		return err
	}
	defer unlock()

	m := gormigrate.New(GetDB(), &gormigrate.Options{
		TableName:                 migrationTable,
		UseTransaction:            true,
		ValidateUnknownMigrations: true,
	}, migrations.List())
	if isFreshDatabase() {
		m.InitSchema(autoMigrateModels)
	}
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}
	if err := autoMigrateModels(GetDB()); err != nil {
		return err
	}
	return createQueryIndexes()
}

// isFreshDatabase 既没有迁移记录也没有业务表时视为全新库
func isFreshDatabase() bool {
	migrator := GetDB().Migrator()
	return !migrator.HasTable(migrationTable) && !migrator.HasTable(&model.User{})
}

// lockMigration Postgres 下在独立连接上持有咨询锁直到迁移结束；SQLite 只支持单实例，无需加锁
func lockMigration() (func(), error) {
	if GetDB().Dialector.Name() != "postgres" {
		return func() {}, nil
	}
	sqlDB, err := GetDB().DB()
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", migrationLockKey); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("acquire migration lock: %w", err)
	}
	return func() {
		_, _ = conn.ExecContext(ctx, "SELECT pg_advisory_unlock($1)", migrationLockKey)
		_ = conn.Close()
	}, nil
}

// autoMigrateModels 按最新模型补齐表和列（只做增量，不删列、不改名）
func autoMigrateModels(tx *gorm.DB) error {
	return tx.AutoMigrate(models...)
}
