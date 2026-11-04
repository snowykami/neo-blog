package service

import (
	"encoding/json"
	"os"
	"runtime"
	"slices"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 运行时指标：多副本部署时每个后端实例定时把自己的快照写进共享状态，管理员查看时列出全部存活实例；
// 单实例（未配置 Redis）时只有本实例

const (
	runtimeMetricsKeyPrefix = "runtime_metrics:"
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

// runtimeSnapshot 本实例的实时快照
func runtimeSnapshot() dto.RuntimeInstanceDto {
	return dto.RuntimeInstanceDto{
		InstanceID: sharedstate.InstanceID(),
		Hostname:   processHostname,
		PID:        os.Getpid(),
		StartedAt:  processStartedAt,
		UpdatedAt:  time.Now(),
		Metrics:    collectRuntimeMetrics(),
	}
}

// ReportRuntimeMetrics 把本实例的快照写进共享状态，由定时任务在每个实例上调用
func ReportRuntimeMetrics() error {
	return sharedstate.SetJSON(runtimeMetricsKeyPrefix+sharedstate.InstanceID(), runtimeSnapshot(), runtimeMetricsTTL)
}

// ListRuntimeMetrics 全部存活实例的运行时指标；处理本次请求的实例使用实时数据，其余为最近一次上报的快照
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
	return &dto.RuntimeMetricsResp{Shared: sharedstate.Shared(), Instances: instances}, nil
}
