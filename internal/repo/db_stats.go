package repo

import (
	"context"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// 数据库的运行统计，供后台「系统运行」的依赖服务展示。Postgres 读取自带的统计视图，不需要扩展和额外权限
// （其他用户的会话只能看到存在，看不到状态与查询原文）；SQLite 只有文件大小与连接池

// activeDBConfig 当前使用的数据库配置（初始化时记录），用于显示连接位置与 SQLite 文件路径
var activeDBConfig DBConfig

// DatabaseCounters 自统计重置以来的累计计数，由调用方按两次之间的增量换算成速率
type DatabaseCounters struct {
	Commits      int64 `json:"commits"`
	Rollbacks    int64 `json:"rollbacks"`
	BlocksRead   int64 `json:"blocks_read"`
	BlocksHit    int64 `json:"blocks_hit"`
	RowsFetched  int64 `json:"rows_fetched"`
	RowsInserted int64 `json:"rows_inserted"`
	RowsUpdated  int64 `json:"rows_updated"`
	RowsDeleted  int64 `json:"rows_deleted"`
	Deadlocks    int64 `json:"deadlocks"`
	TempFiles    int64 `json:"temp_files"`
}

// DatabaseStats 一次读取的数据库统计
type DatabaseStats struct {
	Driver              string
	Version             string
	Location            string // host:port/dbname 或 SQLite 文件路径，不含密码
	MaxConnections      int
	TotalConnections    int // 服务器上全部客户端连接（所有库与用户）
	Active              int // 以下为本站数据库中各状态的连接
	IdleInTransaction   int
	Idle                int
	Waiting             int // 在等锁的连接
	LongestQuerySeconds float64
	SizeBytes           int64
	WALBytes            int64 // SQLite 的 WAL 文件
	PoolInUse           int
	PoolOpen            int
	Counters            DatabaseCounters
}

// ReadDatabaseStats 读取当前数据库的运行统计
func ReadDatabaseStats(ctx context.Context) (*DatabaseStats, error) {
	conn := GetDB().WithContext(ctx)
	stats := &DatabaseStats{Driver: conn.Dialector.Name(), Location: dbLocation(activeDBConfig)}
	if sqlDB, err := conn.DB(); err == nil {
		pool := sqlDB.Stats()
		stats.PoolInUse, stats.PoolOpen = pool.InUse, pool.OpenConnections
	}
	if stats.Driver != "postgres" {
		_ = conn.Raw("SELECT sqlite_version()").Row().Scan(&stats.Version)
		if info, err := os.Stat(activeDBConfig.Path); err == nil {
			stats.SizeBytes = info.Size()
		}
		if info, err := os.Stat(activeDBConfig.Path + "-wal"); err == nil {
			stats.WALBytes = info.Size()
		}
		return stats, nil
	}

	var maxConnections string
	if err := conn.Raw("SHOW server_version").Row().Scan(&stats.Version); err != nil {
		return nil, err
	}
	if err := conn.Raw("SHOW max_connections").Row().Scan(&maxConnections); err != nil {
		return nil, err
	}
	stats.MaxConnections, _ = strconv.Atoi(maxConnections)
	if err := conn.Raw("SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend'").Row().Scan(&stats.TotalConnections); err != nil {
		return nil, err
	}
	rows, err := conn.Raw(`SELECT COALESCE(state, ''), count(*) FROM pg_stat_activity
		WHERE datname = current_database() AND backend_type = 'client backend' GROUP BY 1`).Rows()
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var state string
		var n int
		if err := rows.Scan(&state, &n); err != nil {
			_ = rows.Close()
			return nil, err
		}
		switch state {
		case "active":
			stats.Active = n
		case "idle in transaction", "idle in transaction (aborted)":
			stats.IdleInTransaction += n
		case "idle":
			stats.Idle = n
		}
	}
	_ = rows.Close()
	if err := conn.Raw(`SELECT count(*) FILTER (WHERE wait_event_type = 'Lock'),
		COALESCE(EXTRACT(EPOCH FROM max(now() - query_start) FILTER (WHERE state = 'active' AND pid <> pg_backend_pid())), 0)
		FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend'`).Row().Scan(&stats.Waiting, &stats.LongestQuerySeconds); err != nil {
		return nil, err
	}
	c := &stats.Counters
	if err := conn.Raw(`SELECT xact_commit, xact_rollback, blks_read, blks_hit, tup_fetched, tup_inserted, tup_updated, tup_deleted, deadlocks, temp_files,
		pg_database_size(current_database()) FROM pg_stat_database WHERE datname = current_database()`).Row().
		Scan(&c.Commits, &c.Rollbacks, &c.BlocksRead, &c.BlocksHit, &c.RowsFetched, &c.RowsInserted, &c.RowsUpdated, &c.RowsDeleted, &c.Deadlocks, &c.TempFiles, &stats.SizeBytes); err != nil {
		return nil, err
	}
	return stats, nil
}

// dbLocation 连接位置（不含用户名与密码）：Postgres 为 host:port/dbname，SQLite 为文件路径
func dbLocation(c DBConfig) string {
	if c.Driver != "postgres" {
		return c.Path
	}
	if u, err := url.Parse(c.DSN); err == nil && u.Host != "" {
		return u.Host + u.Path
	}
	// key=value 形式的连接串
	fields := map[string]string{}
	for _, part := range strings.Fields(c.DSN) {
		if key, value, found := strings.Cut(part, "="); found {
			fields[key] = value
		}
	}
	return fields["host"] + ":" + fields["port"] + "/" + fields["dbname"]
}
