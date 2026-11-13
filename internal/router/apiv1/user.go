package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerUserRoutes(group *route.RouterGroup) {
	const userRoute = "/user"
	userController := controller.NewUserController()
	apiTokenController := controller.NewAPITokenController()

	userGroupWithAuth := group.Group(userRoute).Use(middleware.UseAuth(true))
	userGroupNoAuth := group.Group(userRoute).Use(middleware.UseAuth(false))
	userGroupWithCaptcha := group.Group(userRoute).Use(middleware.UseCaptcha())
	{
		// 需要人机验证
		userGroupWithCaptcha.POST("/login", userController.Login)
		userGroupWithCaptcha.POST("/register", userController.Register)
		// 无需鉴权（未登录发验证码需人机验证，已登录换绑邮箱按账号限流）
		userGroupNoAuth.POST("/email/verify", middleware.UseCaptchaForAnon(), userController.VerifyEmail)
		userGroupNoAuth.GET("/captcha", userController.GetCaptchaConfig)
		userGroupNoAuth.GET("/oidc/list", userController.GetOidcConfigList)
		userGroupNoAuth.GET("/oidc/authorize/:name", userController.OidcAuthorize) // 点击第三方登录时访问，绑定时需已登录
		userGroupNoAuth.GET("/oidc/login/:name", userController.OidcLogin)
		userGroupNoAuth.GET("/u/:id", userController.GetUser)
		userGroupNoAuth.GET("/username/:username", userController.GetUserByUsername)
		userGroupNoAuth.GET("/ip-location/:id", userController.GetUserLastIPLocation) // 获取用户最后登录IP的地理位置
		// 需要鉴权
		userGroupWithAuth.POST("/logout", userController.Logout)
		userGroupWithAuth.GET("/me", userController.GetLoginUser)
		// 提及功能：登录用户按用户名 / 昵称搜索可被 @ 的人
		userGroupWithAuth.GET("/search", userController.SearchUsers)
		userGroupWithAuth.PUT("/u/:id", userController.UpdateUser)
		userGroupWithAuth.PUT("/password/edit", userController.ChangePassword)
		userGroupWithAuth.GET("/openids", userController.GetUserOpenIDList)      // 获取登录用户的OIDC列表
		userGroupWithAuth.DELETE("/openid/:id", userController.DeleteUserOpenID) // 删除、解绑登录用户的某个OIDC绑定
		// 个人 API Token：仅浏览器会话可管理，API Token 本身无法访问这些接口
		userGroupWithAuth.GET("/api-tokens", apiTokenController.List)
		userGroupWithAuth.POST("/api-tokens", apiTokenController.Create)
		userGroupWithAuth.POST("/api-tokens/:id/revoke", apiTokenController.Revoke)
		// 需要邮箱验证但是不需要登录（由 service 先校验格式/唯一性后再消费一次性验证码）
		userGroupNoAuth.PUT("/password/reset", userController.ResetPassword)
		// 需要邮箱验证和登录
		userGroupWithAuth.PUT("/email/edit", userController.ChangeEmail)
	}
}
