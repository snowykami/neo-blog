package service

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 依赖服务（数据库与 Redis）的运行统计：定时任务每 15 秒由一个实例采集，速率按与上次采集之间的增量计算。
// 上次的累计计数与历史同快照一起存进共享状态，下一轮换到别的实例采集也能接着算

const (
	dependencyMetricsKey       = "dependency_metrics"
	dependencyMetricsTTL       = 2 * time.Minute
	dependencyMetricsTimeout   = 10 * time.Second
	dependencyMaxSampleGap     = 5 * time.Minute // 两次采集相隔太久（如全部实例都重启过）时不算增量
	dependencyKeyScanLimit     = 20000           // 统计键分布时最多扫描的键数
	dependencyEvictedWindow    = 4               // 淘汰数按最近 4 次采集（约 1 分钟）合计
	dependencyHistoryLengthMax = runtimeHistoryPoints
)

// redisKeyGroups 键名第一段 → 用途分组（界面上的名称由前端翻译）
var redisKeyGroups = map[string]string{
	"session_touch": "sessions", "session_ip": "sessions",
	"rate_limit": "rate_limits",
	"lock":       "locks", "task_round": "locks", "storage_migration": "locks",
	"ai": "ai", "ai_call": "ai", "ai_summary": "ai", "lyric_annotation": "ai",
	"runtime_metrics": "metrics", "fe_runtime_metrics": "metrics", "dependency_metrics": "metrics",
	"oidc_state": "auth", "verify_email": "auth", "verify_email_ip": "auth",
}

// redisCounters Redis 自启动以来的累计计数
type redisCounters struct {
	Commands   int64   `json:"commands"`
	Hits       int64   `json:"hits"`
	Misses     int64   `json:"misses"`
	Expired    int64   `json:"expired"`
	Evicted    int64   `json:"evicted"`
	CPUSeconds float64 `json:"cpu_seconds"`
}

// dependencyState 存在共享状态中的采集状态：给后台看的快照，以及计算下一次增量用的累计计数与历史
type dependencyState struct {
	Snapshot        dto.DependencyMetricsDto `json:"snapshot"`
	At              time.Time                `json:"at"`
	DB              *repo.DatabaseCounters   `json:"db,omitempty"`
	Redis           *redisCounters           `json:"redis,omitempty"`
	DeadlockHistory []int64                  `json:"deadlock_history"` // 每次采集新增的死锁数
	TempFileHistory []int64                  `json:"temp_file_history"`
	EvictedHistory  []int64                  `json:"evicted_history"`
}

// SampleDependencyMetrics 采集一次数据库与 Redis 的运行统计，由定时任务调用（多副本时每轮只有一个实例执行）
func SampleDependencyMetrics() {
	ctx, cancel := context.WithTimeout(context.Background(), dependencyMetricsTimeout)
	defer cancel()
	var prev dependencyState
	if _, err := sharedstate.GetJSON(dependencyMetricsKey, &prev); err != nil {
		logrus.Warnf("read dependency metrics: %v", err)
	}
	now := time.Now()
	elapsed := now.Sub(prev.At).Seconds()
	if prev.At.IsZero() || elapsed <= 0 || now.Sub(prev.At) > dependencyMaxSampleGap {
		elapsed = 0 // 没有可用的上次计数，这次只记录基线
	}
	next := &dependencyState{At: now}
	next.Snapshot.UpdatedAt = now
	next.Snapshot.Database = sampleDatabase(ctx, &prev, next, elapsed)
	next.Snapshot.Redis = sampleRedis(&prev, next, elapsed)
	if err := sharedstate.SetJSON(dependencyMetricsKey, next, dependencyMetricsTTL); err != nil {
		logrus.Warnf("save dependency metrics: %v", err)
	}
}

// GetDependencyMetrics 最近一次采集的结果；还没有采集过时为 nil
func GetDependencyMetrics() *dto.DependencyMetricsDto {
	var state dependencyState
	found, err := sharedstate.GetJSON(dependencyMetricsKey, &state)
	if err != nil || !found {
		return nil
	}
	return &state.Snapshot
}

// delta 累计计数的增量；计数被重置（统计清零、服务重启）时为 0
func delta(current, previous int64) int64 {
	return max(0, current-previous)
}

func appendHistory[T any](history []T, value T) []T {
	history = append(slices.Clone(history), value)
	if len(history) > dependencyHistoryLengthMax {
		history = history[len(history)-dependencyHistoryLengthMax:]
	}
	return history
}

func sum64(values []int64) int64 {
	var total int64
	for _, v := range values {
		total += v
	}
	return total
}

func sampleDatabase(ctx context.Context, prev, next *dependencyState, elapsed float64) *dto.DatabaseMetricsDto {
	stats, err := repo.ReadDatabaseStats(ctx)
	if err != nil {
		logrus.Warnf("read database stats: %v", err)
		return &dto.DatabaseMetricsDto{Error: "unavailable", TransactionsHistory: []float64{}}
	}
	m := &dto.DatabaseMetricsDto{
		Driver: stats.Driver, Version: stats.Version, Location: stats.Location,
		MaxConnections: stats.MaxConnections, TotalConnections: stats.TotalConnections,
		Active: stats.Active, IdleInTransaction: stats.IdleInTransaction, Idle: stats.Idle, Waiting: stats.Waiting,
		LongestQuerySeconds: stats.LongestQuerySeconds, SizeBytes: stats.SizeBytes, WALBytes: stats.WALBytes,
		PoolInUse: stats.PoolInUse, PoolOpen: stats.PoolOpen,
	}
	if stats.Driver != "postgres" {
		m.TransactionsHistory = []float64{}
		return m
	}
	c := stats.Counters
	next.DB = &c
	// 缓存命中率：有读写时按这段时间算，否则用累计值
	hit, read := c.BlocksHit, c.BlocksRead
	var tps float64
	var deadlocks, tempFiles int64
	if p := prev.DB; p != nil && elapsed > 0 {
		tps = float64(delta(c.Commits, p.Commits)+delta(c.Rollbacks, p.Rollbacks)) / elapsed
		rows := delta(c.RowsFetched, p.RowsFetched) + delta(c.RowsInserted, p.RowsInserted) + delta(c.RowsUpdated, p.RowsUpdated) + delta(c.RowsDeleted, p.RowsDeleted)
		m.RowsPerSecond = float64(rows) / elapsed
		if dh, dr := delta(c.BlocksHit, p.BlocksHit), delta(c.BlocksRead, p.BlocksRead); dh+dr > 0 {
			hit, read = dh, dr
		}
		deadlocks, tempFiles = delta(c.Deadlocks, p.Deadlocks), delta(c.TempFiles, p.TempFiles)
	}
	if hit+read > 0 {
		m.CacheHitRatio = float64(hit) / float64(hit+read)
	}
	m.TransactionsPerSecond = tps
	next.DeadlockHistory = appendHistory(prev.DeadlockHistory, deadlocks)
	next.TempFileHistory = appendHistory(prev.TempFileHistory, tempFiles)
	m.DeadlocksRecent, m.TempFilesRecent = sum64(next.DeadlockHistory), sum64(next.TempFileHistory)
	previous := []float64{}
	if prev.Snapshot.Database != nil && elapsed > 0 {
		previous = prev.Snapshot.Database.TransactionsHistory
	}
	if elapsed > 0 {
		m.TransactionsHistory = appendHistory(previous, tps)
	} else {
		m.TransactionsHistory = previous
	}
	return m
}

func sampleRedis(prev, next *dependencyState, elapsed float64) *dto.RedisMetricsDto {
	info, ok, err := sharedstate.ServerInfo()
	if !ok {
		return nil
	}
	if err != nil {
		logrus.Warnf("read redis info: %v", err)
		return &dto.RedisMetricsDto{Error: "unavailable", OpsHistory: []float64{}, KeyGroups: []dto.RedisKeyGroupDto{}}
	}
	f := info.Fields
	num := func(key string) int64 {
		v, _ := strconv.ParseInt(f[key], 10, 64)
		return v
	}
	float := func(key string) float64 {
		v, _ := strconv.ParseFloat(f[key], 64)
		return v
	}
	c := redisCounters{
		Commands: num("total_commands_processed"), Hits: num("keyspace_hits"), Misses: num("keyspace_misses"),
		Expired: num("expired_keys"), Evicted: num("evicted_keys"), CPUSeconds: float("used_cpu_sys") + float("used_cpu_user"),
	}
	next.Redis = &c
	m := &dto.RedisMetricsDto{
		Version: f["redis_version"], Location: fmt.Sprintf("%s / db %d", info.Addr, info.DB),
		UsedMemory: num("used_memory"), MaxMemory: num("maxmemory"), RSS: num("used_memory_rss"), Fragmentation: float("mem_fragmentation_ratio"),
		Clients: int(num("connected_clients")), BlockedClients: int(num("blocked_clients")),
		Keys: redisDBKeys(f[fmt.Sprintf("db%d", info.DB)]),
	}
	hits, misses := c.Hits, c.Misses
	var evicted int64
	if p := prev.Redis; p != nil && elapsed > 0 {
		m.OpsPerSecond = float64(delta(c.Commands, p.Commands)) / elapsed
		m.ExpiredPerSecond = float64(delta(c.Expired, p.Expired)) / elapsed
		m.CPUPercent = max(0, c.CPUSeconds-p.CPUSeconds) / elapsed * 100
		if dh, dm := delta(c.Hits, p.Hits), delta(c.Misses, p.Misses); dh+dm > 0 {
			hits, misses = dh, dm
		}
		evicted = delta(c.Evicted, p.Evicted)
	}
	if hits+misses > 0 {
		m.HitRatio = float64(hits) / float64(hits+misses)
	}
	next.EvictedHistory = appendHistory(prev.EvictedHistory, evicted)
	m.EvictedPerMinute = sum64(next.EvictedHistory[max(0, len(next.EvictedHistory)-dependencyEvictedWindow):])
	previous := []float64{}
	if prev.Snapshot.Redis != nil && elapsed > 0 {
		previous = prev.Snapshot.Redis.OpsHistory
	}
	if elapsed > 0 {
		m.OpsHistory = appendHistory(previous, m.OpsPerSecond)
	} else {
		m.OpsHistory = previous
	}
	m.KeyGroups, m.KeyGroupsComplete = redisKeyGroupCounts()
	return m
}

// redisDBKeys 解析 INFO keyspace 中的「keys=123,expires=4,avg_ttl=0」
func redisDBKeys(raw string) int64 {
	for _, part := range strings.Split(raw, ",") {
		if value, found := strings.CutPrefix(part, "keys="); found {
			n, _ := strconv.ParseInt(value, 10, 64)
			return n
		}
	}
	return 0
}

// redisKeyGroupCounts 本站的键按用途分组计数，数量多的在前，「其他」放最后
func redisKeyGroupCounts() ([]dto.RedisKeyGroupDto, bool) {
	raw, complete, _, err := sharedstate.CountKeys(dependencyKeyScanLimit)
	if err != nil {
		logrus.Warnf("count redis keys: %v", err)
		return []dto.RedisKeyGroupDto{}, false
	}
	counts := map[string]int{}
	for prefix, n := range raw {
		group, ok := redisKeyGroups[prefix]
		if !ok {
			group = "other"
		}
		counts[group] += n
	}
	groups := make([]dto.RedisKeyGroupDto, 0, len(counts))
	for group, n := range counts {
		groups = append(groups, dto.RedisKeyGroupDto{Group: group, Count: n})
	}
	slices.SortFunc(groups, func(a, b dto.RedisKeyGroupDto) int {
		if (a.Group == "other") != (b.Group == "other") {
			if a.Group == "other" {
				return 1
			}
			return -1
		}
		if a.Count != b.Count {
			return b.Count - a.Count
		}
		return strings.Compare(a.Group, b.Group)
	})
	return groups, complete
}
