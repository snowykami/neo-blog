package dto

type FileUploadReq struct {
	Group string `form:"group"` // 文件分组
	Name  string `form:"name"`  // 文件名称
}
