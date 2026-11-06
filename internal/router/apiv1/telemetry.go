package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
)

// telemetry 错误报告上报（公开，登录状态可选：已登录时事件关联到用户）
func registerTelemetryRoutes(group *route.RouterGroup) {
	group.POST("/telemetry/envelope", middleware.UseAuth(false), controller.Telemetry.Envelope)
}
