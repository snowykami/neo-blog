package dto

type FileUploadReq struct {
	Group      string `form:"group"`       // 文件分组
	Name       string `form:"name"`        // 文件名称
	ProviderID uint   `form:"provider_id"` // 存储提供者ID，没有就使用默认的
}
