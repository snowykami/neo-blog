package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func registerFileRoutes(group *route.RouterGroup) {
	fileController := controller.NewFileController()
	fileGroup := group.Group("/file").Use(middleware.UseAuth(true))
	fileGroupWithoutAuth := group.Group("/file").Use(middleware.UseAuth(false))
	fileGroupWithAdmin := group.Group("/file").Use(middleware.UseAuth(true), middleware.UseRole(constant.RoleAdmin))
	// 上传额外接受具有 files:write 的个人 API Token，便于外部 AI 工具上传文章配图
	fileGroupUpload := group.Group("/file").Use(middleware.UseAuth(true, constant.ScopeFilesWrite))
	{
		// 公共接口
		fileGroupWithoutAuth.GET("/f/:id", fileController.GetFile)
		fileGroupWithoutAuth.GET("/f/:id/*filename", fileController.GetFile) // 下载文件 Download file
		fileGroupWithoutAuth.HEAD("/f/:id", fileController.GetFile)
		fileGroupWithoutAuth.HEAD("/f/:id/*filename", fileController.GetFile)

		fileGroupUpload.POST("/f", fileController.UploadFileStream) // 上传文件 Upload file
		fileGroup.DELETE("/f/:id", fileController.DeleteFile)       // 删除文件 Delete file
		fileGroup.DELETE("/batch", fileController.BatchDeleteFiles) // 批量删除文件 Batch delete files
		fileGroup.GET("/file-list", fileController.ListFiles)       // 列出文件 List files

		// filedriver
		fileGroupWithAdmin.POST("/provider", fileController.CreateStorageProvider)       // 创建存储提供者 Create storage provider
		fileGroupWithAdmin.PUT("/provider/:id", fileController.UpdateStorageProvider)    // 更新存储提供者 Update storage provider
		fileGroupWithAdmin.DELETE("/provider/:id", fileController.DeleteStorageProvider) // 删除存储提供者 Delete storage provider
		fileGroupWithAdmin.GET("/provider-list", fileController.ListStorageProviders)    // 列出存储提供者 List storage providers
	}
}
