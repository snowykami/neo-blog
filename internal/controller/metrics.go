package v1

import (
	"bytes"
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/metrics"
)

type metricsType struct{}

// Metrics Prometheus 指标端点
var Metrics = &metricsType{}

// Prometheus 输出本实例的 Prometheus 指标（text exposition 格式）。未配置 METRICS_TOKEN 或令牌不对时一律返回 404，不暴露端点是否存在
func (m *metricsType) Prometheus(ctx context.Context, c *app.RequestContext) {
	if !service.MetricsEndpointAuthorized(string(c.GetHeader("Authorization"))) {
		c.SetStatusCode(http.StatusNotFound)
		c.SetBodyString("404 page not found")
		return
	}
	var buf bytes.Buffer
	if err := service.WritePrometheusMetrics(&buf); err != nil {
		logrus.Warnf("write prometheus metrics: %v", err)
		c.SetStatusCode(http.StatusInternalServerError)
		return
	}
	c.Response.Header.Set("Cache-Control", "no-store")
	c.Data(http.StatusOK, metrics.ContentType, buf.Bytes())
}
