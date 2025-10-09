package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func registerMiscRoutes(group *route.RouterGroup) {
	miscController := v1.NewMiscController()
	miscGroupWithAdmin := group.Group("/misc").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleAdmin))
	miscGroup := group.Group("/misc").Use(middleware.UseAuth(false))
	{
		miscGroup.GET("/site-info", miscController.GetSiteInfo)         // 用于前端展示站点信息
		miscGroup.GET("/public-config", miscController.GetPublicConfig) // 用于公开的键值对
		miscGroup.GET("/sitemap-data", miscController.GetSitemapData)   // 用于sitemap
		miscGroup.GET("/rss-data", miscController.GetRssData)           // 用于rss

		miscGroupWithAdmin.PUT("/public-config", miscController.SetPublicConfig)
		miscGroupWithAdmin.GET("/metrics", miscController.GetMetrics) // 仅管理员可见
	}
}
