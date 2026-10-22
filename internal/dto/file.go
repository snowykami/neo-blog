package dto

type FileUploadReq struct {
	Group      string `form:"group"`       // 文件分组
	Name       string `form:"name"`        // 文件名称
	ProviderID uint   `form:"provider_id"` // 存储提供者ID，没有就使用默认的
}

// FileListReq 资产库列表查询参数
type FileListReq struct {
	PaginationParams
	Query string `query:"query"` // 文件名关键字，多个用逗号分隔
	Type  string `query:"type"`  // 类型筛选：image / video / audio / other，为空不筛选
	Scope string `query:"scope"` // 范围：mine（默认，仅本人） / all（全部，仅管理员）
}
