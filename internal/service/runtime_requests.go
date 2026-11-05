package service

import (
	"sync/atomic"
	"time"
)

// 请求统计：中间件在每个请求开始和结束时计数，运行时指标每次上报时取与上次的增量，算出请求/秒、平均延迟与 5xx 比例

type requestCounters struct {
	inflight atomic.Int64  // 进行中（含歌词流等长连接）
	total    atomic.Uint64 // 已结束的请求数
	errors   atomic.Uint64 // 已结束的 5xx 请求数
	nanos    atomic.Uint64 // 已结束请求的累计耗时
}

var requestStats requestCounters

// requestStatsSkipped 不计入统计的路径：探针每几秒请求一次，会掩盖真实流量
func requestStatsSkipped(path string) bool {
	return path == "/healthz" || path == "/readyz"
}

// TrackRequest 请求开始时调用，返回在请求结束时以响应状态码调用的函数
func TrackRequest(path string) func(status int) {
	if requestStatsSkipped(path) {
		return func(int) {}
	}
	requestStats.inflight.Add(1)
	start := time.Now()
	return func(status int) {
		requestStats.inflight.Add(-1)
		requestStats.nanos.Add(uint64(time.Since(start)))
		if status >= 500 {
			requestStats.errors.Add(1)
		}
		requestStats.total.Add(1)
	}
}
