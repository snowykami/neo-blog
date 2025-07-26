package dto

type CommentDto struct {
	ID         uint    `json:"id"`
	TargetID   uint    `json:"target_id"`
	TargetType string  `json:"target_type"` // 目标类型，如 "post", "page"
	Content    string  `json:"content"`
	ReplyID    uint    `json:"reply_id"` // 回复的评论ID
	Depth      int     `json:"depth"`    // 评论的层级深度
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
	User       UserDto `json:"user"` // 评论的
}

type CreateCommentReq struct {
	TargetID   uint   `json:"target_id" binding:"required"`   // 目标ID
	TargetType string `json:"target_type" binding:"required"` // 目标类型，如 "post", "page"
	Content    string `json:"content" binding:"required"`     // 评论内容
	ReplyID    uint   `json:"reply_id"`                       // 回复的评论ID
}

type UpdateCommentReq struct {
	CommentID uint   `json:"comment_id" binding:"required"` // 评论ID
	Content   string `json:"content" binding:"required"`    // 评论内容
}
