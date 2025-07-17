package router

import (
	"errors"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/snowykami/neo-blog/internal/router/apiv1"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

var h *server.Hertz

func Run() error {
	mode := utils.Getenv("MODE", constant.ModeProd) // dev | prod
	switch mode {
	case constant.ModeProd:
		h.Spin()
		return nil
	case constant.ModeDev:
		return h.Run()
	default:
		return errors.New("unknown mode: " + mode)
	}
}

func init() {
	h = server.New(
		server.WithHostPorts(":"+utils.Getenv("PORT", "8888")),
		server.WithMaxRequestBodySize(utils.GetenvAsInt("MAX_REQUEST_BODY_SIZE", 1048576000)), // 1000MiB
	)
	apiv1.RegisterRoutes(h)
}
