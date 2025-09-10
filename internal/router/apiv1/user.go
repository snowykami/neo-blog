package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerUserRoutes(group *route.RouterGroup) {
	userController := v1.NewUserController()
	userGroup := group.Group("/user").Use(middleware.UseAuth(true))
	userGroupWithoutAuth := group.Group("/user").Use(middleware.UseAuth(false))
	userGroupWithoutAuthNeedsCaptcha := group.Group("/user").Use(middleware.UseCaptcha())
	{
		userGroupWithoutAuthNeedsCaptcha.POST("/login", userController.Login)
		userGroupWithoutAuthNeedsCaptcha.POST("/register", userController.Register)
		userGroupWithoutAuthNeedsCaptcha.POST("/email/verify", userController.VerifyEmail) // Send email verification code
		userGroupWithoutAuth.GET("/captcha", userController.GetCaptchaConfig)
		userGroupWithoutAuth.GET("/oidc/list", userController.OidcList)
		userGroupWithoutAuth.GET("/oidc/login/:name", userController.OidcLogin)
		userGroupWithoutAuth.GET("/u/:id", userController.GetUser)
		userGroupWithoutAuth.GET("/username/:username", userController.GetUserByUsername)
		userGroup.GET("/me", userController.GetUser)
		userGroupWithoutAuth.POST("/logout", userController.Logout)
		userGroup.PUT("/u/:id", userController.UpdateUser)
		userGroup.PUT("/password/edit", userController.ChangePassword)
		userGroup.PUT("/email/edit", userController.ChangeEmail)
	}
}
