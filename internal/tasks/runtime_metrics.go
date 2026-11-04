package tasks

import (
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/service"
)

// StartRuntimeMetricsReporter 每个实例都定时上报自己的运行时指标（不是每轮只由一个实例执行的任务）
func StartRuntimeMetricsReporter() {
	report := func() {
		if err := service.ReportRuntimeMetrics(); err != nil {
			logrus.Warnf("report runtime metrics failed: %v", err)
		}
	}
	report()
	go func() {
		ticker := time.NewTicker(service.RuntimeMetricsInterval)
		defer ticker.Stop()
		for range ticker.C {
			report()
		}
	}()
}
