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

func Run() error {
	if utils.IsDevMode {
		logrus.Infoln("Running in development mode")
		return h.Run()
	} else {
		logrus.Infoln("Running in production mode")
		h.Spin()
		return nil
	}
}

func init() {
	h = server.New(
		server.WithHostPorts(":"+utils.Env.Get("PORT", "8888")),
		server.WithMaxRequestBodySize(utils.Env.GetAsInt(constant.EnvKeyMaxRequestBodySize, constant.DefaultMaxRequestBodySize)),
		// 流式读取请求体：上传大文件时由 multipart 解析落盘，不再整体缓存在内存中
		server.WithStreamBody(true),
	)
	h.Use(recovery.Recovery(), middleware.UseTrack())
	apiv1.RegisterRoutes(h)
	h.GET("/healthz", func(ctx context.Context, c *app.RequestContext) {
		resps.Ok(c, "ok", nil)
	})
}
