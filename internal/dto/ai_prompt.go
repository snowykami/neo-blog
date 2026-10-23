package dto

// AIPromptDto 编辑器 AI 快捷指令
type AIPromptDto struct {
	ID          uint   `json:"id"`
	Scope       string `json:"scope"` // platform 平台指令 / user 个人指令
	Mode        string `json:"mode"`  // write 帮写 / rewrite 润色
	Label       string `json:"label"`
	Instruction string `json:"instruction"`
	Editable    bool   `json:"editable"` // 当前用户能否编辑、删除
}

// CreateOrUpdateAIPromptReq 新增 / 修改 AI 指令；修改时不能变更范围
type CreateOrUpdateAIPromptReq struct {
	ID          uint   `path:"id" json:"id"`
	Scope       string `json:"scope"`
	Mode        string `json:"mode"`
	Label       string `json:"label"`
	Instruction string `json:"instruction"`
}
