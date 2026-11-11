package metrics

import (
	"runtime"
	"sync"
	"time"
)

var (
	registerRuntimeOnce sync.Once
	processStart        = time.Now()

	memStatsMu   sync.Mutex
	memStats     runtime.MemStats
	memStatsRead time.Time
)

// readMemStats 一次抓取会读取多项内存指标，ReadMemStats 需要短暂暂停全部协程，1 秒内复用同一份
func readMemStats() runtime.MemStats {
	memStatsMu.Lock()
	defer memStatsMu.Unlock()
	if time.Since(memStatsRead) > time.Second {
		runtime.ReadMemStats(&memStats)
		memStatsRead = time.Now()
	}
	return memStats
}

// RegisterGoRuntime 注册 Go 运行时的基础指标（与 prometheus client 的同名指标含义一致），重复调用只注册一次
func RegisterGoRuntime() {
	registerRuntimeOnce.Do(func() {
		NewCollectorFunc("go_info", "Information about the Go environment.", "gauge", []string{"version"}, func() []Sample {
			return []Sample{{LabelValues: []string{runtime.Version()}, Value: 1}}
		})
		NewGaugeFunc("go_goroutines", "Number of goroutines that currently exist.", func() float64 {
			return float64(runtime.NumGoroutine())
		})
		NewGaugeFunc("go_memstats_alloc_bytes", "Number of bytes allocated and still in use.", func() float64 {
			return float64(readMemStats().Alloc)
		})
		NewGaugeFunc("go_memstats_heap_inuse_bytes", "Number of heap bytes that are in use.", func() float64 {
			return float64(readMemStats().HeapInuse)
		})
		NewGaugeFunc("go_memstats_heap_objects", "Number of allocated objects.", func() float64 {
			return float64(readMemStats().HeapObjects)
		})
		NewGaugeFunc("go_memstats_sys_bytes", "Number of bytes obtained from system.", func() float64 {
			return float64(readMemStats().Sys)
		})
		NewCollectorFunc("go_gc_cycles_total", "Number of completed GC cycles.", "counter", nil, func() []Sample {
			return []Sample{{Value: float64(readMemStats().NumGC)}}
		})
		NewCollectorFunc("go_gc_pause_seconds_total", "Total GC stop-the-world pause time in seconds.", "counter", nil, func() []Sample {
			return []Sample{{Value: float64(readMemStats().PauseTotalNs) / 1e9}}
		})
		NewGaugeFunc("process_start_time_seconds", "Start time of the process since unix epoch in seconds.", func() float64 {
			return float64(processStart.UnixNano()) / 1e9
		})
	})
}
