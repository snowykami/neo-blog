package dto

type ToggleLikeOrIsLikedOrLikedUsersReq struct {
	TargetID   uint   `query:"target_id" json:"target_id" binding:"required"`
	TargetType string `query:"target_type" json:"target_type" binding:"required"` // 目标类型，如 "post", "comment"
	Number     int    `query:"number" json:"number"`                              // 获取点赞用户数量，默认20，最大100
}
