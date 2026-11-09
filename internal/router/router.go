package router

import (
	"context"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/middlewares/server/recovery"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/router/apiv1"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/utils"
)

var h *server.Hertz

// shuttingDown 收到退出信号后置为 true，就绪检查随即失败
var shuttingDown atomic.Bool

const (
	defaultShutdownDelay = 5 * time.Second // 收到退出信号到开始关停 HTTP 服务的等待时间，留给负载均衡摘掉本实例
	readyzTimeout        = 2 * time.Second
)

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
			// 先让就绪检查失败，等负载均衡把本实例摘掉后再关停，滚动更新时请求不会打到正在关闭的实例
			shuttingDown.Store(true)
			if delay := shutdownDelay(); delay > 0 {
				logrus.Infof("shutting down in %s", delay)
				time.Sleep(delay)
			}
			// 编辑事件流是长连接，不会自行结束：先结束它们，客户端随即重连到其他实例，也不拖慢关停
			service.CloseEditEventStreams()
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
	// panic 与 5xx 记为后端错误报告，可在控制台查看
	// 压缩注册在文件链接改写之前：先等其他中间件处理完响应体，再整体压缩
	h.Use(recovery.Recovery(recovery.WithRecoveryHandler(middleware.RecoveryHandler)), middleware.UseCompress(), middleware.UseTrack(), middleware.UseErrorReport(), middleware.UseFileLinks())
	apiv1.RegisterRoutes(h)
	// 存活检查：进程能响应即可，不依赖数据库，避免数据库抖动时实例被反复重启
	h.GET("/healthz", func(ctx context.Context, c *app.RequestContext) {
		resps.Ok(c, "ok", nil)
	})
	h.GET("/readyz", readyz)
}

// readyz 就绪检查：正在关停或连不上数据库时返回 503，负载均衡据此不再把请求转给本实例；
// 新实例在数据库迁移完成、开始监听后才会就绪，滚动更新时配置有误的新实例不会接到请求
func readyz(ctx context.Context, c *app.RequestContext) {
	if shuttingDown.Load() {
		resps.Custom(c, http.StatusServiceUnavailable, "shutting_down", nil)
		return
	}
	pingCtx, cancel := context.WithTimeout(ctx, readyzTimeout)
	defer cancel()
	if err := repo.Ping(pingCtx); err != nil {
		logrus.Warnf("readyz: database unavailable: %v", err)
		resps.Custom(c, http.StatusServiceUnavailable, "database_unavailable", nil)
		return
	}
	resps.Ok(c, "ok", nil)
}

// shutdownDelay 收到退出信号后等待多久再关停 HTTP 服务（SHUTDOWN_DELAY_SECONDS，开发模式默认不等待）
func shutdownDelay() time.Duration {
	def := defaultShutdownDelay
	if utils.IsDevMode {
		def = 0
	}
	return time.Duration(utils.Env.GetAsInt(constant.EnvKeyShutdownDelaySeconds, int(def/time.Second))) * time.Second
}
