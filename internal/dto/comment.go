package dto

type CommentDto struct {
  ID             uint    `json:"id"`
  TargetID       uint    `json:"target_id"`
  TargetType     string  `json:"target_type"` // 目标类型，如 "post", "page"
  Content        string  `json:"content"`
  ReplyID        uint    `json:"reply_id"` // 回复的评论ID
  Depth          int     `json:"depth"`    // 评论的层级深度
  CreatedAt      string  `json:"created_at"`
  UpdatedAt      string  `json:"updated_at"`
  User           UserDto `json:"user"`        // 评论的
  ReplyCount     uint64  `json:"reply_count"` // 回复数量
  LikeCount      uint64  `json:"like_count"`  // 点赞数量
  IsLiked        bool    `json:"is_liked"`    // 当前用户是否点赞
  IsPrivate      bool    `json:"is_private"`
  Location       string  `json:"location"` // 用户位置，基于IP
  OS             string  `json:"os"`       // 用户操作系统，基于User-Agent
  Browser        string  `json:"browser"`  // 用户浏览器，基于User-Agent
  ShowClientInfo bool    `json:"show_client_info"`
}

type CreateCommentReq struct {
  TargetID       uint   `json:"target_id" binding:"required"`   // 目标ID
  TargetType     string `json:"target_type" binding:"required"` // 目标类型，如 "post", "page"
  Content        string `json:"content" binding:"required"`     // 评论内容
  ReplyID        uint   `json:"reply_id"`                       // 回复的评论ID
  IsPrivate      bool   `json:"is_private"`                     // 是否私密评论，默认false
  RemoteAddr     string `json:"remote_addr"`                    // 远程地址
  UserAgent      string `json:"user_agent"`                     // 用户代理
  ShowClientInfo bool   `json:"show_client_info"`               // 是否显示客户端信息
}

type UpdateCommentReq struct {
  CommentID      uint   `json:"comment_id" binding:"required"` // 评论ID
  Content        string `json:"content" binding:"required"`    // 评论内容
  IsPrivate      bool   `json:"is_private"`                    // 是否私密
  ShowClientInfo bool   `json:"show_client_info"`              // 是否显示客户端信息
}

type GetCommentListReq struct {
  TargetID   uint   `json:"target_id" binding:"required"`
  TargetType string `json:"target_type" binding:"required"`
  CommentID  uint   `json:"comment_id"` // 获取某条评论的所有子评论
  OrderBy    string `json:"order_by"`   // 排序方式
  Page       uint64 `json:"page"`       // 页码
  Size       uint64 `json:"size"`
  Desc       bool   `json:"desc"`
  Depth      int    `json:"depth"` // 评论的层级深度
}
