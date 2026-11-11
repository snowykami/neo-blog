package metrics

import (
	"strings"
	"testing"
)

// 计数器与直方图按 text exposition 格式输出：标签值转义、直方图的桶累计、+Inf / _sum / _count
func TestRegistryWrite(t *testing.T) {
	reg := &Registry{}
	counter := &CounterVec{name: "test_requests_total", help: "Requests.", labels: []string{"route", "status"}, values: map[string]*counterSeries{}}
	hist := &HistogramVec{name: "test_duration_seconds", help: "Duration.", labels: []string{"route"}, buckets: []float64{0.1, 1}, values: map[string]*histogramSeries{}}
	reg.register(counter)
	reg.register(hist)
	reg.register(&funcCollector{name: "test_up", help: "Up.", typ: "gauge", fn: func() []Sample { return []Sample{{Value: 1}} }})

	counter.Inc("/p/:id", "200")
	counter.Add(2, "/p/:id", "200")
	counter.Inc(`/a"b\c`+"\n", "500")
	counter.Inc("only-one-label") // 标签个数不对时忽略
	hist.Observe(0.05, "/p/:id")
	hist.Observe(0.1, "/p/:id") // 等于上界计入该桶
	hist.Observe(3, "/p/:id")

	var b strings.Builder
	if err := reg.Write(&b); err != nil {
		t.Fatal(err)
	}
	got := b.String()
	for _, want := range []string{
		"# HELP test_requests_total Requests.\n# TYPE test_requests_total counter\n",
		`test_requests_total{route="/p/:id",status="200"} 3` + "\n",
		`test_requests_total{route="/a\"b\\c\n",status="500"} 1` + "\n",
		"# TYPE test_duration_seconds histogram\n",
		`test_duration_seconds_bucket{route="/p/:id",le="0.1"} 2` + "\n",
		`test_duration_seconds_bucket{route="/p/:id",le="1"} 2` + "\n",
		`test_duration_seconds_bucket{route="/p/:id",le="+Inf"} 3` + "\n",
		`test_duration_seconds_sum{route="/p/:id"} 3.15` + "\n",
		`test_duration_seconds_count{route="/p/:id"} 3` + "\n",
		"# TYPE test_up gauge\ntest_up 1\n",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("output missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "only-one-label") {
		t.Fatalf("series with wrong label count should be dropped:\n%s", got)
	}
}

// 标签组合数达到上限后新的组合不再记录，已有的照常累计
func TestCounterSeriesLimit(t *testing.T) {
	c := &CounterVec{name: "x", labels: []string{"k"}, values: map[string]*counterSeries{}}
	for i := 0; i < maxSeries+10; i++ {
		c.Inc(strings.Repeat("a", i%7) + string(rune('A'+i%26)) + string(rune(i)))
	}
	if len(c.values) > maxSeries {
		t.Fatalf("series = %d, want <= %d", len(c.values), maxSeries)
	}
}

// Go 运行时指标可以注册并输出
func TestGoRuntimeMetrics(t *testing.T) {
	RegisterGoRuntime()
	RegisterGoRuntime() // 重复调用只注册一次
	var b strings.Builder
	if err := Default.Write(&b); err != nil {
		t.Fatal(err)
	}
	got := b.String()
	for _, name := range []string{"go_goroutines ", "go_memstats_alloc_bytes ", "process_start_time_seconds ", `go_info{version="go`} {
		if !strings.Contains(got, name) {
			t.Fatalf("missing %s:\n%s", name, got)
		}
	}
	if strings.Count(got, "# TYPE go_goroutines gauge") != 1 {
		t.Fatalf("runtime metrics registered more than once")
	}
}
