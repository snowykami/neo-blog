package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerFileRoutes(group *route.RouterGroup) {
	fileController := v1.NewFileController()
	fileGroup := group.Group("/file").Use(middleware.UseAuth(true))
	fileGroupWithoutAuth := group.Group("/file").Use(middleware.UseAuth(false))
	{
		fileGroup.POST("/f", fileController.UploadFileStream)      // 上传文件 Upload file
		fileGroup.DELETE("/f/:id", fileController.DeleteFile)      // 删除文件 Delete file
		fileGroupWithoutAuth.GET("/f/:id", fileController.GetFile) // 下载文件 Download file
	}
}
