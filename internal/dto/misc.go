package dto

import "time"

// RuntimeInstanceDto 一个后端实例的运行时指标快照
type RuntimeInstanceDto struct {
	InstanceID string         `json:"instance_id"`
	Hostname   string         `json:"hostname"` // 容器部署时为容器 / Pod 名
	PID        int            `json:"pid"`
	StartedAt  time.Time      `json:"started_at"`
	UpdatedAt  time.Time      `json:"updated_at"` // 快照时间；处理本次请求的实例为实时数据
	Current    bool           `json:"current"`    // 是否为处理本次请求的实例
	Core       RuntimeCoreDto `json:"core"`
	// RequestsHistory 最近若干次上报时的请求/秒（旧的在前），用于画趋势线
	RequestsHistory []float64      `json:"requests_history"`
	Metrics         map[string]any `json:"metrics"` // 全部 Go 运行时指标
}

// RuntimeCoreDto 后端实例的核心指标；速率类指标按最近两次上报之间的增量计算
type RuntimeCoreDto struct {
	RequestsPerSecond float64 `json:"requests_per_second"`
	InflightRequests  int64   `json:"inflight_requests"` // 进行中的请求（含长连接）
	AvgLatencyMs      float64 `json:"avg_latency_ms"`    // 这段时间内结束的请求的平均耗时
	ErrorRate         float64 `json:"error_rate"`        // 5xx 占比，0～1
	CPUPercent        float64 `json:"cpu_percent"`       // 1 核 = 100
	MemoryRSS         uint64  `json:"memory_rss"`        // 进程占用；取不到时为 Go 从系统申请的内存
	HeapInuse         uint64  `json:"heap_inuse"`
	Goroutines        int     `json:"goroutines"`
	DBInUse           int     `json:"db_in_use"` // 数据库连接池：使用中
	DBOpen            int     `json:"db_open"`   // 数据库连接池：已打开
}

// FrontendInstanceDto 一个前端（Next.js）实例的运行时指标快照，由前端写进共享状态
type FrontendInstanceDto struct {
	InstanceID      string          `json:"instance_id"`
	Hostname        string          `json:"hostname"`
	PID             int             `json:"pid"`
	StartedAt       time.Time       `json:"started_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	Core            FrontendCoreDto `json:"core"`
	RequestsHistory []float64       `json:"requests_history"`
	Metrics         map[string]any  `json:"metrics"` // 全部 Node 运行时指标
}

// FrontendCoreDto 前端实例的核心指标
type FrontendCoreDto struct {
	RequestsPerSecond float64 `json:"requests_per_second"`
	InflightRequests  int64   `json:"inflight_requests"`
	AvgLatencyMs      float64 `json:"avg_latency_ms"`
	ErrorRate         float64 `json:"error_rate"`
	CPUPercent        float64 `json:"cpu_percent"`
	MemoryRSS         uint64  `json:"memory_rss"`
	HeapUsed          uint64  `json:"heap_used"`
	Connections       int     `json:"connections"`       // 当前打开的 HTTP 连接
	EventLoopP99Ms    float64 `json:"event_loop_p99_ms"` // 事件循环延迟 p99
}

// RuntimeMetricsResp 全部存活前后端实例的运行时指标
type RuntimeMetricsResp struct {
	Shared       bool                  `json:"shared"` // 是否通过 Redis 共享（多副本可见）；否则只有本实例
	Instances    []RuntimeInstanceDto  `json:"instances"`
	Frontends    []FrontendInstanceDto `json:"frontends"`    // 前端实例写进共享状态的快照；前端没有配置 Redis 时为空
	Dependencies *DependencyMetricsDto `json:"dependencies"` // 数据库与 Redis；启动后第一次采集前为空
}

// DependencyMetricsDto 依赖服务（数据库与 Redis）的运行统计，每 15 秒由一个实例采集
type DependencyMetricsDto struct {
	UpdatedAt time.Time           `json:"updated_at"`
	Database  *DatabaseMetricsDto `json:"database"`
	Redis     *RedisMetricsDto    `json:"redis"` // 未使用 Redis（共享状态在进程内存）时为空
}

// DatabaseMetricsDto 数据库的运行统计；速率类指标按最近两次采集之间的增量计算
type DatabaseMetricsDto struct {
	Driver                string    `json:"driver"` // postgres / sqlite
	Version               string    `json:"version"`
	Location              string    `json:"location"` // host:port/dbname 或 SQLite 文件路径
	Error                 string    `json:"error,omitempty"`
	MaxConnections        int       `json:"max_connections"`
	TotalConnections      int       `json:"total_connections"` // 服务器上全部客户端连接
	Active                int       `json:"active"`            // 以下为本站数据库中各状态的连接
	IdleInTransaction     int       `json:"idle_in_transaction"`
	Idle                  int       `json:"idle"`
	Waiting               int       `json:"waiting"` // 在等锁的连接
	LongestQuerySeconds   float64   `json:"longest_query_seconds"`
	TransactionsPerSecond float64   `json:"transactions_per_second"`
	TransactionsHistory   []float64 `json:"transactions_history"`
	CacheHitRatio         float64   `json:"cache_hit_ratio"` // 0～1
	RowsPerSecond         float64   `json:"rows_per_second"`
	SizeBytes             int64     `json:"size_bytes"`
	WALBytes              int64     `json:"wal_bytes"`
	DeadlocksRecent       int64     `json:"deadlocks_recent"`  // 近 10 分钟新增
	TempFilesRecent       int64     `json:"temp_files_recent"` // 近 10 分钟新增
	PoolInUse             int       `json:"pool_in_use"`       // 处理这次采集的后端实例的连接池
	PoolOpen              int       `json:"pool_open"`
}

// RedisMetricsDto 共享状态所在 Redis 的运行统计
type RedisMetricsDto struct {
	Version           string             `json:"version"`
	Location          string             `json:"location"` // host:port / db
	Error             string             `json:"error,omitempty"`
	UsedMemory        int64              `json:"used_memory"`
	MaxMemory         int64              `json:"max_memory"` // 0 表示没有设置上限
	RSS               int64              `json:"rss"`
	Fragmentation     float64            `json:"fragmentation"`
	OpsPerSecond      float64            `json:"ops_per_second"`
	OpsHistory        []float64          `json:"ops_history"`
	Clients           int                `json:"clients"`
	BlockedClients    int                `json:"blocked_clients"`
	HitRatio          float64            `json:"hit_ratio"`   // 0～1
	CPUPercent        float64            `json:"cpu_percent"` // 1 核 = 100
	Keys              int64              `json:"keys"`        // 所在 db 的键总数
	ExpiredPerSecond  float64            `json:"expired_per_second"`
	EvictedPerMinute  int64              `json:"evicted_per_minute"`
	KeyGroups         []RedisKeyGroupDto `json:"key_groups"` // 本站的键按用途分组，数量多的在前
	KeyGroupsComplete bool               `json:"key_groups_complete"`
}

// RedisKeyGroupDto 一类用途的键数量；group 为 sessions / rate_limits / locks / ai / metrics / music / auth / other
type RedisKeyGroupDto struct {
	Group string `json:"group"`
	Count int    `json:"count"`
}
