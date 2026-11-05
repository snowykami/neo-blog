package service

import (
	"os"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// 每个实例上报快照，列表包含全部存活实例；处理请求的实例为实时数据，下线的实例过期后消失
func TestListRuntimeMetrics(t *testing.T) {
	stores := map[string]func() error{"memory": func() error { sharedstate.UseMemory(); return nil }}
	if url := os.Getenv("NEO_TEST_REDIS_URL"); url != "" {
		stores["redis"] = func() error {
			return sharedstate.Init(url, "neo-blog-test:metrics:"+time.Now().Format("150405.000")+":")
		}
	}
	t.Cleanup(sharedstate.UseMemory)
	for name, use := range stores {
		t.Run(name, func(t *testing.T) {
			if err := use(); err != nil {
				t.Fatal(err)
			}
			// 单实例：只有自己，且为实时数据
			resp, svcerr := ListRuntimeMetrics()
			if svcerr != nil || len(resp.Instances) != 1 || !resp.Instances[0].Current || resp.Instances[0].Metrics["goroutines"] == nil {
				t.Fatalf("single = %+v %v", resp, svcerr)
			}
			if err := ReportRuntimeMetrics(); err != nil {
				t.Fatal(err)
			}
			// 另一个实例的快照（较早启动），以及一个即将过期的实例
			other := dto.RuntimeInstanceDto{InstanceID: "other", Hostname: "pod-b", StartedAt: processStartedAt.Add(-time.Hour), UpdatedAt: time.Now(), Metrics: map[string]any{"goroutines": 7}}
			if err := sharedstate.SetJSON(runtimeMetricsKeyPrefix+"other", other, time.Minute); err != nil {
				t.Fatal(err)
			}
			gone := dto.RuntimeInstanceDto{InstanceID: "gone", Hostname: "pod-c", StartedAt: time.Now()}
			if err := sharedstate.SetJSON(runtimeMetricsKeyPrefix+"gone", gone, 50*time.Millisecond); err != nil {
				t.Fatal(err)
			}
			time.Sleep(120 * time.Millisecond)
			resp, svcerr = ListRuntimeMetrics()
			if svcerr != nil || len(resp.Instances) != 2 {
				t.Fatalf("multi = %+v %v", resp, svcerr)
			}
			if resp.Instances[0].InstanceID != "other" || resp.Instances[0].Current || resp.Instances[0].Hostname != "pod-b" {
				t.Fatalf("first should be the older other instance: %+v", resp.Instances[0])
			}
			if !resp.Instances[1].Current || resp.Instances[1].InstanceID != sharedstate.InstanceID() {
				t.Fatalf("second should be the current instance: %+v", resp.Instances[1])
			}
			if resp.Shared != (name == "redis") {
				t.Fatalf("shared = %v", resp.Shared)
			}
		})
	}
}

// 核心指标按两次上报之间的增量计算：请求/秒、平均延迟、5xx 比例；探针不计入；趋势只保留最近的若干点
func TestRuntimeCoreSampler(t *testing.T) {
	sampler := &coreSampler{at: time.Now()}
	before := requestStats.inflight.Load()
	finish := []func(int){TrackRequest("/api/v1/post/list"), TrackRequest("/api/v1/post/list"), TrackRequest("/api/v1/user/me")}
	skipped := TrackRequest("/readyz")
	if got := requestStats.inflight.Load() - before; got != 3 {
		t.Fatalf("inflight = %d, probes should not count", got)
	}
	core, _ := sampler.snapshot()
	if core.InflightRequests-before != 3 || core.Goroutines == 0 {
		t.Fatalf("live values = %+v", core)
	}
	time.Sleep(20 * time.Millisecond)
	finish[0](200)
	finish[1](503)
	finish[2](200)
	skipped(200)
	sampler.at = sampler.at.Add(-2 * time.Second) // 让这段时间约为 2 秒
	sampler.sample(time.Now())
	core, history := sampler.snapshot()
	if core.RequestsPerSecond < 1 || core.RequestsPerSecond > 1.6 {
		t.Fatalf("rps = %v", core.RequestsPerSecond)
	}
	if core.AvgLatencyMs < 10 || core.ErrorRate < 0.3 || core.ErrorRate > 0.34 || core.MemoryRSS == 0 {
		t.Fatalf("core = %+v", core)
	}
	if len(history) != 1 || history[0] != core.RequestsPerSecond {
		t.Fatalf("history = %v", history)
	}
	for range runtimeHistoryPoints + 5 {
		sampler.sample(time.Now())
	}
	if _, history := sampler.snapshot(); len(history) != runtimeHistoryPoints {
		t.Fatalf("history length = %d", len(history))
	}
}

// 前端实例写进共享状态的快照一起列出，按启动时间排序；过期后消失
func TestListFrontendMetrics(t *testing.T) {
	sharedstate.UseMemory()
	t.Cleanup(sharedstate.UseMemory)
	for _, fe := range []dto.FrontendInstanceDto{
		{InstanceID: "fe-b", Hostname: "web-b", StartedAt: time.Now(), Core: dto.FrontendCoreDto{Connections: 3}},
		{InstanceID: "fe-a", Hostname: "web-a", StartedAt: time.Now().Add(-time.Minute), RequestsHistory: []float64{1, 2}},
	} {
		if err := sharedstate.SetJSON(frontendMetricsKeyPrefix+fe.InstanceID, fe, time.Minute); err != nil {
			t.Fatal(err)
		}
	}
	_ = sharedstate.Current().Set(frontendMetricsKeyPrefix+"broken", "{", time.Minute)
	resp, svcerr := ListRuntimeMetrics()
	if svcerr != nil || len(resp.Frontends) != 2 || resp.Frontends[0].Hostname != "web-a" || resp.Frontends[1].Core.Connections != 3 {
		t.Fatalf("frontends = %+v %v", resp, svcerr)
	}
	if resp.Frontends[1].RequestsHistory == nil {
		t.Fatal("history should never be null")
	}
}

// 依赖服务采集：结果存进共享状态，列表接口一起返回；未使用 Redis 时只有数据库
func TestSampleDependencyMetrics(t *testing.T) {
	setupEditTest(t)
	sharedstate.UseMemory()
	t.Cleanup(sharedstate.UseMemory)
	if resp, _ := ListRuntimeMetrics(); resp.Dependencies != nil {
		t.Fatal("no dependency metrics before the first sample")
	}
	SampleDependencyMetrics()
	SampleDependencyMetrics()
	resp, svcerr := ListRuntimeMetrics()
	if svcerr != nil || resp.Dependencies == nil || resp.Dependencies.Database == nil {
		t.Fatalf("resp = %+v %v", resp, svcerr)
	}
	db := resp.Dependencies.Database
	if db.Driver != "sqlite" || db.Version == "" || db.Error != "" || db.TransactionsHistory == nil {
		t.Fatalf("database = %+v", db)
	}
	if resp.Dependencies.Redis != nil {
		t.Fatal("redis metrics should be absent without redis")
	}
}

func TestRedisDBKeys(t *testing.T) {
	if got := redisDBKeys("keys=1284,expires=900,avg_ttl=0"); got != 1284 {
		t.Fatalf("keys = %d", got)
	}
	if got := redisDBKeys(""); got != 0 {
		t.Fatalf("keys = %d", got)
	}
}
