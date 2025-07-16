package v1

import "github.com/cloudwego/hertz/pkg/app/server"

func RegisterRoutes(h *server.Hertz) {
	apiV1Group := h.Group("/api/v1")
	registerUserRoutes(apiV1Group)
}
