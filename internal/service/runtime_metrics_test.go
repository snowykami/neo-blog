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
