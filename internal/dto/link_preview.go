package dto

// LinkPreviewReq 外链预览查询参数：
// 匿名访客或普通用户必须传入公开内容对应的 target_type / target_id，且 url 存在于该内容中；
// 编辑者与管理员在后台编辑器或预览页中可直接查询尚未保存的外链
type LinkPreviewReq struct {
	URL        string `query:"url"`
	TargetType string `query:"target_type"` // post / page / sidebar
	TargetID   uint   `query:"target_id"`
}

// LinkPreviewDto 外链预览元信息
type LinkPreviewDto struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image,omitempty"`
	Favicon     string `json:"favicon,omitempty"`
	URL         string `json:"url"`
	SiteName    string `json:"site_name,omitempty"`
}
