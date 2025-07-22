package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerUserRoutes(group *route.RouterGroup) {
	userGroup := group.Group("/user").Use(middleware.UseAuth(true))
	userGroupWithoutAuth := group.Group("/user")
	userGroupWithoutAuthNeedsCaptcha := userGroupWithoutAuth.Use(middleware.UseCaptcha())
	{
		userGroupWithoutAuthNeedsCaptcha.POST("/login", v1.User.Login)
		userGroupWithoutAuthNeedsCaptcha.POST("/register", v1.User.Register)
		userGroupWithoutAuthNeedsCaptcha.POST("/email/verify", v1.User.VerifyEmail) // Send email verification code
		userGroupWithoutAuth.GET("/oidc/list", v1.User.OidcList)
		userGroupWithoutAuth.GET("/oidc/login/:name", v1.User.OidcLogin)
		userGroupWithoutAuth.GET("/u/:id", v1.User.GetUser)
		userGroup.POST("/logout", v1.User.Logout)
		userGroup.PUT("/u/:id", v1.User.UpdateUser)
	}
}
