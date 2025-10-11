package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerUserRoutes(group *route.RouterGroup) {
	const userRoute = "/user"
	userController := v1.NewUserController()

	userGroupWithAuth := group.Group(userRoute).Use(middleware.UseAuth(true))
	userGroupNoAuth := group.Group(userRoute).Use(middleware.UseAuth(false))
	userGroupWithCaptcha := group.Group(userRoute).Use(middleware.UseCaptcha())
	{
		// 需要人机验证
		userGroupWithCaptcha.POST("/login", userController.Login)
		userGroupWithCaptcha.POST("/register", userController.Register)
		// 无需鉴权
		userGroupNoAuth.POST("/email/verify", userController.VerifyEmail) // Send email verification code
		userGroupNoAuth.GET("/captcha", userController.GetCaptchaConfig)
		userGroupNoAuth.GET("/oidc/list", userController.GetOidcConfigList)
		userGroupNoAuth.GET("/oidc/login/:name", userController.OidcLogin)
		userGroupNoAuth.GET("/u/:id", userController.GetUser)
		userGroupNoAuth.GET("/username/:username", userController.GetUserByUsername)
		// 需要鉴权
		userGroupWithAuth.POST("/logout", userController.Logout)
		userGroupWithAuth.GET("/me", userController.GetLoginUser)
		userGroupWithAuth.PUT("/u/:id", userController.UpdateUser)
		userGroupWithAuth.PUT("/password/edit", userController.ChangePassword)
		userGroupWithAuth.GET("/openids", userController.GetUserOpenIDList) // 获取登录用户的OIDC列表
		// 需要邮箱验证但是不需要登录
		group.Group(userRoute).Use(middleware.UseEmailVerify()).PUT("/password/reset", userController.ResetPassword) // 不需要登录
		// 需要邮箱验证和登录
		group.Group(userRoute).Use(middleware.UseAuth(true), middleware.UseEmailVerify()).PUT("/email/edit", userController.ChangeEmail)
	}
}
