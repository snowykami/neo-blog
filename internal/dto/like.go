package dto

type ToggleLikeReq struct {
	TargetID   uint   `json:"target_id" binding:"required"`
	TargetType string `json:"target_type" binding:"required"` // 目标类型，如 "post", "comment"
}
