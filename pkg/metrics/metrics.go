// Package metrics 极简的 Prometheus 指标：计数器、直方图与按需读取的仪表，按 text exposition 格式（0.0.4）输出。
// 不引入 prometheus client，只实现本项目用到的部分；指标只在本进程内累计，多副本时由 Prometheus 按实例分别抓取
package metrics

import (
	"bufio"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// ContentType 指标端点的响应类型
const ContentType = "text/plain; version=0.0.4; charset=utf-8"

// maxSeries 每个指标最多保留的标签组合数：超出后新的组合不再记录，避免标签取值失控时占满内存
const maxSeries = 5000

// collector 一个指标族
type collector interface {
	write(w *bufio.Writer)
}

// Registry 指标注册表，按注册顺序输出
type Registry struct {
	mu         sync.Mutex
	collectors []collector
}

// Default 全局注册表
var Default = &Registry{}

func (r *Registry) register(c collector) {
	r.mu.Lock()
	r.collectors = append(r.collectors, c)
	r.mu.Unlock()
}

// Write 按 text exposition 格式输出全部指标
func (r *Registry) Write(w io.Writer) error {
	r.mu.Lock()
	collectors := append([]collector(nil), r.collectors...)
	r.mu.Unlock()
	bw := bufio.NewWriter(w)
	for _, c := range collectors {
		c.write(bw)
	}
	return bw.Flush()
}

// ---------- 计数器 ----------

// CounterVec 带标签的计数器
type CounterVec struct {
	name, help string
	labels     []string
	mu         sync.Mutex
	values     map[string]*counterSeries
}

type counterSeries struct {
	labelValues []string
	value       float64
}

// NewCounterVec 创建并注册到 Default
func NewCounterVec(name, help string, labels ...string) *CounterVec {
	c := &CounterVec{name: name, help: help, labels: labels, values: map[string]*counterSeries{}}
	Default.register(c)
	return c
}

// Add 增加 v（v 应为非负数）；标签值个数须与定义一致
func (c *CounterVec) Add(v float64, labelValues ...string) {
	if len(labelValues) != len(c.labels) || v < 0 {
		return
	}
	key := seriesKey(labelValues)
	c.mu.Lock()
	defer c.mu.Unlock()
	s, ok := c.values[key]
	if !ok {
		if len(c.values) >= maxSeries {
			return
		}
		s = &counterSeries{labelValues: append([]string(nil), labelValues...)}
		c.values[key] = s
	}
	s.value += v
}

// Inc 加一
func (c *CounterVec) Inc(labelValues ...string) { c.Add(1, labelValues...) }

func (c *CounterVec) write(w *bufio.Writer) {
	c.mu.Lock()
	defer c.mu.Unlock()
	writeHeader(w, c.name, c.help, "counter")
	for _, key := range sortedKeys(c.values) {
		s := c.values[key]
		writeSample(w, c.name, c.labels, s.labelValues, "", "", s.value)
	}
}

// ---------- 直方图 ----------

// DefaultBuckets 请求耗时的默认分桶（秒）
var DefaultBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

// HistogramVec 带标签的直方图
type HistogramVec struct {
	name, help string
	labels     []string
	buckets    []float64
	mu         sync.Mutex
	values     map[string]*histogramSeries
}

type histogramSeries struct {
	labelValues []string
	counts      []uint64 // 各桶（不累计）的次数
	sum         float64
	count       uint64
}

// NewHistogramVec 创建并注册到 Default；buckets 须升序
func NewHistogramVec(name, help string, buckets []float64, labels ...string) *HistogramVec {
	h := &HistogramVec{name: name, help: help, labels: labels, buckets: buckets, values: map[string]*histogramSeries{}}
	Default.register(h)
	return h
}

// Observe 记录一次观测值
func (h *HistogramVec) Observe(v float64, labelValues ...string) {
	if len(labelValues) != len(h.labels) || math.IsNaN(v) {
		return
	}
	key := seriesKey(labelValues)
	h.mu.Lock()
	defer h.mu.Unlock()
	s, ok := h.values[key]
	if !ok {
		if len(h.values) >= maxSeries {
			return
		}
		s = &histogramSeries{labelValues: append([]string(nil), labelValues...), counts: make([]uint64, len(h.buckets))}
		h.values[key] = s
	}
	if i := sort.SearchFloat64s(h.buckets, v); i < len(h.buckets) {
		s.counts[i]++
	}
	s.sum += v
	s.count++
}

func (h *HistogramVec) write(w *bufio.Writer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	writeHeader(w, h.name, h.help, "histogram")
	for _, key := range sortedKeys(h.values) {
		s := h.values[key]
		var cumulative uint64
		for i, upper := range h.buckets {
			cumulative += s.counts[i]
			writeSample(w, h.name+"_bucket", h.labels, s.labelValues, "le", formatFloat(upper), float64(cumulative))
		}
		writeSample(w, h.name+"_bucket", h.labels, s.labelValues, "le", "+Inf", float64(s.count))
		writeSample(w, h.name+"_sum", h.labels, s.labelValues, "", "", s.sum)
		writeSample(w, h.name+"_count", h.labels, s.labelValues, "", "", float64(s.count))
	}
}

// ---------- 按需读取 ----------

// Sample 一个样本：标签值与数值
type Sample struct {
	LabelValues []string
	Value       float64
}

// funcCollector 抓取时才读取的指标（goroutine 数、内存、进行中的请求等）
type funcCollector struct {
	name, help, typ string
	labels          []string
	fn              func() []Sample
}

// NewGaugeFunc 注册一个抓取时读取的仪表（无标签）
func NewGaugeFunc(name, help string, fn func() float64) {
	Default.register(&funcCollector{name: name, help: help, typ: "gauge", fn: func() []Sample {
		return []Sample{{Value: fn()}}
	}})
}

// NewCollectorFunc 注册一个抓取时读取的指标族（typ 为 gauge 或 counter），fn 一次返回全部样本
func NewCollectorFunc(name, help, typ string, labels []string, fn func() []Sample) {
	Default.register(&funcCollector{name: name, help: help, typ: typ, labels: labels, fn: fn})
}

func (f *funcCollector) write(w *bufio.Writer) {
	samples := f.fn()
	writeHeader(w, f.name, f.help, f.typ)
	for _, s := range samples {
		if len(s.LabelValues) != len(f.labels) {
			continue
		}
		writeSample(w, f.name, f.labels, s.LabelValues, "", "", s.Value)
	}
}

// ---------- 输出 ----------

func seriesKey(labelValues []string) string {
	return strings.Join(labelValues, "\xff")
}

func sortedKeys[T any](m map[string]T) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func writeHeader(w *bufio.Writer, name, help, typ string) {
	w.WriteString("# HELP " + name + " " + escapeHelp(help) + "\n")
	w.WriteString("# TYPE " + name + " " + typ + "\n")
}

// writeSample 输出一行样本；extraName 非空时追加一个标签（直方图的 le）
func writeSample(w *bufio.Writer, name string, labels, values []string, extraName, extraValue string, v float64) {
	w.WriteString(name)
	if len(labels) > 0 || extraName != "" {
		w.WriteByte('{')
		for i, label := range labels {
			if i > 0 {
				w.WriteByte(',')
			}
			w.WriteString(label + `="` + escapeLabelValue(values[i]) + `"`)
		}
		if extraName != "" {
			if len(labels) > 0 {
				w.WriteByte(',')
			}
			w.WriteString(extraName + `="` + extraValue + `"`)
		}
		w.WriteByte('}')
	}
	w.WriteByte(' ')
	w.WriteString(formatFloat(v))
	w.WriteByte('\n')
}

func formatFloat(v float64) string {
	switch {
	case math.IsInf(v, 1):
		return "+Inf"
	case math.IsInf(v, -1):
		return "-Inf"
	case math.IsNaN(v):
		return "NaN"
	}
	return strconv.FormatFloat(v, 'g', -1, 64)
}

var (
	labelValueEscaper = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
	helpEscaper       = strings.NewReplacer(`\`, `\\`, "\n", `\n`)
)

func escapeLabelValue(s string) string { return labelValueEscaper.Replace(s) }
func escapeHelp(s string) string       { return helpEscaper.Replace(s) }
