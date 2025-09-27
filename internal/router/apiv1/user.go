package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerUserRoutes(group *route.RouterGroup) {
	const userRoute = "/user"
	userController := v1.NewUserController()
	userGroup := group.Group(userRoute).Use(middleware.UseAuth(true))
	userGroupWithoutAuth := group.Group(userRoute).Use(middleware.UseAuth(false))
	userGroupWithoutAuthNeedsCaptcha := group.Group(userRoute).Use(middleware.UseCaptcha())
	{
		userGroupWithoutAuthNeedsCaptcha.POST("/login", userController.Login)
		userGroupWithoutAuthNeedsCaptcha.POST("/register", userController.Register)
		userGroupWithoutAuth.POST("/email/verify", userController.VerifyEmail) // Send email verification code
		userGroupWithoutAuth.GET("/captcha", userController.GetCaptchaConfig)
		userGroupWithoutAuth.GET("/oidc/list", userController.OidcList)
		userGroupWithoutAuth.GET("/oidc/login/:name", userController.OidcLogin)
		userGroupWithoutAuth.GET("/u/:id", userController.GetUser)
		userGroupWithoutAuth.GET("/username/:username", userController.GetUserByUsername)
		userGroup.POST("/logout", userController.Logout)
		userGroup.GET("/me", userController.GetLoginUser)
		userGroup.PUT("/u/:id", userController.UpdateUser)
		userGroup.PUT("/password/edit", userController.ChangePassword)
		group.Group(userRoute).Use(middleware.UseEmailVerify()).PUT("/password/reset", userController.ResetPassword) // 不需要登录
		group.Group(userRoute).Use(middleware.UseAuth(true), middleware.UseEmailVerify()).PUT("/email/edit", userController.ChangeEmail)
	}
}
