package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func registerMiscRoutes(group *route.RouterGroup) {
	miscController := controller.NewMiscController()
	miscGroupWithAdmin := group.Group("/misc").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleAdmin))
	miscGroup := group.Group("/misc").Use(middleware.UseAuth(false))
	{
		miscGroup.GET("/site-info", miscController.GetSiteInfo)         // 用于前端展示站点信息
		miscGroup.GET("/public-config", miscController.GetPublicConfig) // 用于公开的键值对
		miscGroup.GET("/sitemap-data", miscController.GetSitemapData)   // 用于sitemap
		miscGroup.GET("/rss-data", miscController.GetRssData)           // 用于rss
		// 文章内 GitHub 仓库卡：只返回公开仓库信息，后端缓存
		miscGroup.GET("/github/repos/:owner/:repo", controller.Github.Repo)
		// 文章内天气卡：接受经纬度 / 城市名；按访客 IP 估计城市、按坐标反查地名（均不保存）用于实时卡跟随访客所在地
		miscGroup.GET("/weather", controller.Weather.Current)
		miscGroup.GET("/weather/geo", controller.Weather.Geo)
		miscGroup.GET("/weather/reverse", controller.Weather.Reverse)
		miscGroup.GET("/weather/locate", controller.Weather.Locate)

		miscGroupWithAdmin.PUT("/public-config", miscController.SetPublicConfig)
		miscGroupWithAdmin.GET("/metrics", miscController.GetMetrics) // 仅管理员可见
	}
}
