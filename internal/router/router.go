package router

import (
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/router/apiv1"
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
		server.WithMaxRequestBodySize(utils.Env.GetenvAsInt("MAX_REQUEST_BODY_SIZE", 1048576000)), // 1000MiB
	)
	apiv1.RegisterRoutes(h)
}
