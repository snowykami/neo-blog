package service

import (
	"encoding/json"
	"os"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 运行时指标：多副本部署时每个后端实例定时把自己的快照写进共享状态，管理员查看时列出全部存活实例；
// 前端（Next.js）实例配置了同一个 Redis 时也把快照写在 frontendMetricsKeyPrefix 下，一起列出。
// 单实例（未配置 Redis）时只有本实例

const (
	runtimeMetricsKeyPrefix  = "runtime_metrics:"
	frontendMetricsKeyPrefix = "fe_runtime_metrics:" // 前端写入，键与格式见 web/src/lib/server-metrics.ts
	// runtimeHistoryPoints 趋势线保留的上报次数（每 15 秒一次，共 10 分钟）
	runtimeHistoryPoints = 40
	// RuntimeMetricsInterval 各实例上报快照的间隔
	RuntimeMetricsInterval = 15 * time.Second
	// 快照过期时间：实例下线后最多这么久从列表中消失
	runtimeMetricsTTL = 3 * RuntimeMetricsInterval
)

var (
	processStartedAt = time.Now()
	processHostname  = func() string {
		h, _ := os.Hostname()
		return h
	}()
)

// collectRuntimeMetrics 读取本进程的运行时指标
func collectRuntimeMetrics() map[string]any {
	m := &runtime.MemStats{}
	runtime.ReadMemStats(m)
	lastPause := uint64(0)
	if m.NumGC > 0 {
		lastPause = m.PauseNs[(m.NumGC+255)%256] // 环形缓冲区中最近一次 GC 的暂停时间
	}
	return map[string]any{
		"uptime":     time.Since(processStartedAt),
		"goroutines": runtime.NumGoroutine(),

		"memory_total_alloc": m.TotalAlloc, // 所有被分配过的内存
		"memory_sys":         m.Sys,        // 系统内存占用量
		"memory_mallocs":     m.Mallocs,    // 内存分配次数
		"memory_frees":       m.Frees,      // 内存释放次数
		"memory_lookups":     m.Lookups,    // 指针查找次数

		"memory_heap_alloc":    m.HeapAlloc,    // 堆内存分配
		"memory_heap_sys":      m.HeapSys,      // 堆内存占用
		"memory_heap_inuse":    m.HeapInuse,    // 正在使用的堆内存
		"memory_heap_idle":     m.HeapIdle,     // 空闲的堆内存
		"memory_heap_released": m.HeapReleased, // 释放给操作系统的堆内存
		"memory_heap_objects":  m.HeapObjects,  // 堆内存对象数

		"memory_stack_sys":     m.StackSys,    // 栈内存占用
		"memory_stack_inuse":   m.StackInuse,  // 正在使用的栈内存
		"memory_m_span_sys":    m.MSpanSys,    // MSpan结构体占用内存
		"memory_m_span_inuse":  m.MSpanInuse,  // 正在使用的MSpan内存
		"memory_m_cache_sys":   m.MCacheSys,   // MCache结构体占用内存
		"memory_m_cache_inuse": m.MCacheInuse, // 正在使用的MCache内存
		"memory_buck_hash_sys": m.BuckHashSys, // 哈希表占用内存
		"memory_gc_sys":        m.GCSys,       // 垃圾回收器占用内存
		"memory_other_sys":     m.OtherSys,    // 其他内存占用

		"gc_next":           m.NextGC,        // 下一次垃圾回收的内存目标
		"gc_last":           m.LastGC,        // 上一次垃圾回收的时间
		"gc_pause_total_ns": m.PauseTotalNs,  // 垃圾回收总暂停时间
		"gc_num":            m.NumGC,         // 垃圾回收次数
		"gc_cpu_fraction":   m.GCCPUFraction, // GC CPU占用比例
		"gc_last_pause_ns":  lastPause,       // 最近一次 GC 暂停时间，单位纳秒
	}
}

// coreSampler 每次上报时按与上次上报之间的增量计算核心指标，并保留请求/秒的历史
type coreSampler struct {
	mu      sync.Mutex
	at      time.Time
	total   uint64
	errors  uint64
	nanos   uint64
	cpu     time.Duration
	core    dto.RuntimeCoreDto
	history []float64
}

// 从进程启动开始计算第一次的增量
var runtimeCore = &coreSampler{at: processStartedAt}

func (s *coreSampler) sample(now time.Time) {
	total, errCount, nanos, cpu := requestStats.total.Load(), requestStats.errors.Load(), requestStats.nanos.Load(), processCPUTime()
	m := &runtime.MemStats{}
	runtime.ReadMemStats(m)
	s.mu.Lock()
	defer s.mu.Unlock()
	elapsed := now.Sub(s.at).Seconds()
	core := dto.RuntimeCoreDto{MemoryRSS: processRSS(m.Sys), HeapInuse: m.HeapInuse}
	if elapsed > 0 {
		requests := total - s.total
		core.RequestsPerSecond = float64(requests) / elapsed
		core.CPUPercent = (cpu - s.cpu).Seconds() / elapsed * 100
		if requests > 0 {
			core.AvgLatencyMs = float64(nanos-s.nanos) / float64(requests) / 1e6
			core.ErrorRate = float64(errCount-s.errors) / float64(requests)
		}
	}
	if db := repo.GetDB(); db != nil {
		if sqlDB, err := db.DB(); err == nil {
			stats := sqlDB.Stats()
			core.DBInUse, core.DBOpen = stats.InUse, stats.OpenConnections
		}
	}
	s.at, s.total, s.errors, s.nanos, s.cpu, s.core = now, total, errCount, nanos, cpu, core
	s.history = append(s.history, core.RequestsPerSecond)
	if len(s.history) > runtimeHistoryPoints {
		s.history = s.history[len(s.history)-runtimeHistoryPoints:]
	}
}

// snapshot 最近一次计算的核心指标；进行中的请求与 Goroutine 数取实时值
func (s *coreSampler) snapshot() (dto.RuntimeCoreDto, []float64) {
	s.mu.Lock()
	core, history := s.core, slices.Clone(s.history)
	s.mu.Unlock()
	core.InflightRequests = requestStats.inflight.Load()
	core.Goroutines = runtime.NumGoroutine()
	if history == nil {
		history = []float64{}
	}
	return core, history
}

// processRSS 进程实际占用的物理内存（Linux 读 /proc/self/statm）；取不到时返回 fallback
func processRSS(fallback uint64) uint64 {
	data, err := os.ReadFile("/proc/self/statm")
	if err != nil {
		return fallback
	}
	fields := strings.Fields(string(data))
	if len(fields) < 2 {
		return fallback
	}
	pages, err := strconv.ParseUint(fields[1], 10, 64)
	if err != nil {
		return fallback
	}
	return pages * uint64(os.Getpagesize())
}

// runtimeSnapshot 本实例的实时快照
func runtimeSnapshot() dto.RuntimeInstanceDto {
	core, history := runtimeCore.snapshot()
	environment := currentEnvironment()
	return dto.RuntimeInstanceDto{
		InstanceID:      sharedstate.InstanceID(),
		Hostname:        processHostname,
		PID:             os.Getpid(),
		StartedAt:       processStartedAt,
		UpdatedAt:       time.Now(),
		Core:            core,
		Environment:     &environment,
		RequestsHistory: history,
		Metrics:         collectRuntimeMetrics(),
	}
}

// ReportRuntimeMetrics 计算本实例的核心指标并把快照写进共享状态，由定时任务在每个实例上调用
func ReportRuntimeMetrics() error {
	runtimeCore.sample(time.Now())
	return sharedstate.SetJSON(runtimeMetricsKeyPrefix+sharedstate.InstanceID(), runtimeSnapshot(), runtimeMetricsTTL)
}

// ListRuntimeMetrics 全部存活前后端实例的运行时指标；处理本次请求的后端实例使用实时数据，其余为最近一次上报的快照
func ListRuntimeMetrics() (*dto.RuntimeMetricsResp, *errs.ServiceError) {
	values, err := sharedstate.Current().GetByPrefix(runtimeMetricsKeyPrefix)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	self := runtimeSnapshot()
	self.Current = true
	instances := []dto.RuntimeInstanceDto{self}
	for key, raw := range values {
		if strings.TrimPrefix(key, runtimeMetricsKeyPrefix) == self.InstanceID {
			continue
		}
		var snap dto.RuntimeInstanceDto
		if json.Unmarshal([]byte(raw), &snap) == nil && snap.InstanceID != "" {
			snap.Current = false
			instances = append(instances, snap)
		}
	}
	// 按启动时间排序，同一时刻启动的按主机名
	slices.SortFunc(instances, func(a, b dto.RuntimeInstanceDto) int {
		if c := a.StartedAt.Compare(b.StartedAt); c != 0 {
			return c
		}
		return strings.Compare(a.Hostname, b.Hostname)
	})
	frontends, svcerr := listFrontendMetrics()
	if svcerr != nil {
		return nil, svcerr
	}
	return &dto.RuntimeMetricsResp{Shared: sharedstate.Shared(), Instances: instances, Frontends: frontends, Dependencies: GetDependencyMetrics()}, nil
}

// listFrontendMetrics 前端实例写进共享状态的快照，按启动时间排序
func listFrontendMetrics() ([]dto.FrontendInstanceDto, *errs.ServiceError) {
	values, err := sharedstate.Current().GetByPrefix(frontendMetricsKeyPrefix)
	if err != nil {
		return nil, errs.Internal("failed_to_get_target", err)
	}
	frontends := make([]dto.FrontendInstanceDto, 0, len(values))
	for _, raw := range values {
		var snap dto.FrontendInstanceDto
		if json.Unmarshal([]byte(raw), &snap) == nil && snap.InstanceID != "" {
			if snap.RequestsHistory == nil {
				snap.RequestsHistory = []float64{}
			}
			frontends = append(frontends, snap)
		}
	}
	slices.SortFunc(frontends, func(a, b dto.FrontendInstanceDto) int {
		if c := a.StartedAt.Compare(b.StartedAt); c != 0 {
			return c
		}
		return strings.Compare(a.Hostname, b.Hostname)
	})
	return frontends, nil
}
