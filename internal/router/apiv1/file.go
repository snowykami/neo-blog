package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func registerFileRoutes(group *route.RouterGroup) {
	fileController := v1.NewFileController()
	fileGroup := group.Group("/file").Use(middleware.UseAuth(true))
	fileGroupWithoutAuth := group.Group("/file").Use(middleware.UseAuth(false))
	fileGroupWithAdmin := group.Group("/file").Use(middleware.UseAuth(true), middleware.UseRole(constant.RoleAdmin))
	{
		fileGroup.POST("/f", fileController.UploadFileStream)                // 上传文件 Upload file
		fileGroup.DELETE("/f/:id", fileController.DeleteFile)                // 删除文件 Delete file
		fileGroupWithoutAuth.GET("/f/:id", fileController.GetFile)           // HEAD method for file existence check
		fileGroupWithoutAuth.GET("/f/:id/*filename", fileController.GetFile) // 下载文件 Download file
		fileGroupWithAdmin.GET("/file-list", fileController.ListFiles)       // 列出文件 List files

		// filedriver
		fileGroupWithAdmin.POST("/provider", fileController.CreateStorageProvider)       // 创建存储提供者 Create storage provider
		fileGroupWithAdmin.PUT("/provider/:id", fileController.UpdateStorageProvider)    // 更新存储提供者 Update storage provider
		fileGroupWithAdmin.DELETE("/provider/:id", fileController.DeleteStorageProvider) // 删除存储提供者 Delete storage provider
		fileGroupWithAdmin.GET("/provider", fileController.ListStorageProviders)         // 列出存储提供者 List storage providers
	}
}
