package dto

type PostDto struct {
	UserID    uint       `json:"user_id"` // 发布者的用户ID
	Title     string     `json:"title"`   // 帖子标题
	Content   string     `json:"content"`
	Labels    []LabelDto `json:"labels"`     // 关联的标签
	IsPrivate bool       `json:"is_private"` // 是否为私密帖子
}

type CreateOrUpdatePostReq struct {
	Title     string `json:"title"`
	Content   string `json:"content"`
	IsPrivate bool   `json:"is_private"`
	Labels    []uint `json:"labels"` // 标签ID列表
}
