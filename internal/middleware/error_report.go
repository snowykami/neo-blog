package middleware

import (
	"context"
	"fmt"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
)

// 已作为 panic 记录过的请求，5xx 不再重复记录
const errorReportedKey = "error_reported"

// 存活与就绪检查的 5xx 是实例状态（如正在关停），不是错误
var errorReportSkipPaths = map[string]bool{"/healthz": true, "/readyz": true}

// RecoveryHandler 处理函数 panic 时：写日志、记录错误报告（带调用栈），并返回统一的 500 响应
func RecoveryHandler(ctx context.Context, c *app.RequestContext, err any, stack []byte) {
	logrus.Errorf("[Recovery] err=%v\nstack=%s", err, stack)
	c.Set(errorReportedKey, true)
	report := service.BackendError{
		Panic:  true,
		Status: http.StatusInternalServerError,
		Cause:  fmt.Sprint(err),
		Stack:  stack,
		Method: string(c.Method()),
		Path:   string(c.Path()),
	}
	service.NewErrorReportService().ReportBackendErrorAsync(context.WithoutCancel(ctx), report)
	resps.Error(c, errs.Internal("internal_server_error", fmt.Errorf("panic: %v", err)))
}

// UseErrorReport 把 5xx 响应记为后端错误（错误码与原始错误由 resps 写入请求上下文）
func UseErrorReport() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		c.Next(ctx)
		status := c.Response.StatusCode()
		if status < http.StatusInternalServerError || errorReportSkipPaths[string(c.Path())] {
			return
		}
		if _, reported := c.Get(errorReportedKey); reported {
			return
		}
		report := service.BackendError{
			Status: status,
			Code:   c.GetString("error"),
			Method: string(c.Method()),
			Path:   string(c.Path()),
		}
		if cause, ok := c.Get("error_cause"); ok {
			if err, ok := cause.(error); ok {
				report.Cause = err.Error()
			}
		}
		service.NewErrorReportService().ReportBackendErrorAsync(context.WithoutCancel(ctx), report)
	}
}
