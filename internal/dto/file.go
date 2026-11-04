package dto

import "time"

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

// StorageMigrationReq 发起存储迁移：迁移源存储中的全部文件与 HTML 页面，或只迁移选中的文件（file_ids 不为空时忽略 source_provider_id）
type StorageMigrationReq struct {
	SourceProviderID uint   `json:"source_provider_id"`
	TargetProviderID uint   `json:"target_provider_id"`
	FileIDs          []uint `json:"file_ids"`
}

// StorageMigrationStatus 迁移进度；同一时间只运行一个迁移任务，进度保存在共享状态中，任意实例都能查询
type StorageMigrationStatus struct {
	State            string     `json:"state"`              // running / done / failed / canceled / interrupted（运行的实例已退出）
	Phase            string     `json:"phase"`              // links 还原直链 / files 复制文件 / pages 复制 HTML 页面
	SourceProviderID uint       `json:"source_provider_id"` // 按选中文件迁移时为 0
	TargetProviderID uint       `json:"target_provider_id"`
	ProviderIDs      []uint     `json:"provider_ids"` // 涉及的全部存储，迁移期间不能修改或删除
	FileCount        int        `json:"file_count"`   // 选中的文件数，迁移整个存储时为 0
	Objects          int        `json:"objects"`      // 待迁移的存储对象数（相同内容的文件共用一个对象）
	TotalBytes       int64      `json:"total_bytes"`
	Done             int        `json:"done"`
	Copied           int        `json:"copied"` // 实际复制的对象数，目标中已有相同内容时跳过复制
	Failed           int        `json:"failed"`
	Bytes            int64      `json:"bytes"` // 已处理的字节数
	PageHTMLVersions int        `json:"page_html_versions"`
	PageHTMLDone     int        `json:"page_html_done"`
	LinksUpdated     int        `json:"links_updated"` // 直链还原为稳定链接的记录数
	Errors           []string   `json:"errors"`        // 最近的错误
	StartedAt        time.Time  `json:"started_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	FinishedAt       *time.Time `json:"finished_at"`
}
