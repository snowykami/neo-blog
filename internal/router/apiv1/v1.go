package apiv1

import "github.com/cloudwego/hertz/pkg/app/server"

func RegisterRoutes(h *server.Hertz) {
	apiV1Group := h.Group("/api/v1")
	{
		registerCommentRoutes(apiV1Group)
		registerAdminRoutes(apiV1Group)
		registerFileRoutes(apiV1Group)
		registerLabelRoutes(apiV1Group)
		registerLikeRoutes(apiV1Group)
		registerPageRoutes(apiV1Group)
		registerPostRoutes(apiV1Group)
		registerUserRoutes(apiV1Group)
	}
}
