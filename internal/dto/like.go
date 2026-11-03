package dto

import "time"

type ToggleLikeOrIsLikedOrLikedUsersReq struct {
	TargetID   uint   `query:"target_id" json:"target_id" binding:"required"`
	TargetType string `query:"target_type" json:"target_type" binding:"required"` // 目标类型，如 "post", "comment"
	Number     int    `query:"number" json:"number"`                              // 获取点赞用户数量，默认20，最大100
}

type ListUserLikesReq struct {
	PaginationParams
	UserID uint `query:"user_id" binding:"required" vd:"$>0"` // 点赞者的用户ID
}

// UserLikeDto 用户主页的点赞条目：点赞的文章或评论，附带作者与所在文章/页面
type UserLikeDto struct {
	ID         uint             `json:"id"`
	TargetType string           `json:"target_type"` // "post" 或 "comment"
	TargetID   uint             `json:"target_id"`
	CreatedAt  time.Time        `json:"created_at"` // 点赞时间
	Author     UserDto          `json:"author"`     // 被点赞内容的作者
	Content    string           `json:"content"`    // 评论内容，仅点赞评论时有值
	Target     CommentTargetDto `json:"target"`     // 点赞文章时为文章本身，点赞评论时为评论所在的文章或页面
}
