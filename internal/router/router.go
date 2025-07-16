package router

import (
	"github.com/cloudwego/hertz/pkg/app/server"
	v1 "github.com/snowykami/neo-blog/internal/router/v1"
	"github.com/snowykami/neo-blog/pkg/utils"
)

func init() {
	h := server.New(
		server.WithHostPorts(":"+utils.Getenv("PORT", "8888")),
		server.WithMaxRequestBodySize(utils.GetenvAsInt("MAX_REQUEST_BODY_SIZE", 1048576000)), // 1000MiB
	)
	v1.RegisterRoutes()
}
