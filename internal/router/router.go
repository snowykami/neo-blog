package router

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/middlewares/server/recovery"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/internal/router/apiv1"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
)

var h *server.Hertz

// Run 启动 HTTP 服务并阻塞，直到服务出错或 ctx 结束；ctx 结束（收到退出信号）后优雅关停再返回
func Run(ctx context.Context) error {
	if utils.IsDevMode {
		logrus.Infoln("Running in development mode")
	} else {
		logrus.Infoln("Running in production mode")
	}
	// 退出信号由调用方经 ctx 统一接收，Hertz 不再自行监听
	var runErr error
	h.SetCustomSignalWaiter(func(errCh chan error) error {
		select {
		case <-ctx.Done():
			return nil
		case runErr = <-errCh:
			return runErr
		}
	})
	h.Spin()
	return runErr
}

func init() {
	h = server.New(
		server.WithHostPorts(":"+utils.Env.Get("PORT", "8888")),
		server.WithMaxRequestBodySize(utils.Env.GetAsInt(constant.EnvKeyMaxRequestBodySize, constant.DefaultMaxRequestBodySize)),
		// 流式读取请求体：上传大文件时由 multipart 解析落盘，不再整体缓存在内存中
		server.WithStreamBody(true),
	)
	h.Use(recovery.Recovery(), middleware.UseTrack(), middleware.UseFileLinks())
	apiv1.RegisterRoutes(h)
	h.GET("/healthz", func(ctx context.Context, c *app.RequestContext) {
		resps.Ok(c, "ok", nil)
	})
}
