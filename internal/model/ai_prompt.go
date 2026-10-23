package model

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"gorm.io/gorm"
)

// AI 指令的归属范围
const (
	AIPromptScopePlatform = "platform" // 平台指令：所有编辑者可用，管理员维护
	AIPromptScopeUser     = "user"     // 个人指令：仅创建者可见、可用
)

// AIPrompt 编辑器 AI 写作的快捷指令
type AIPrompt struct {
	gorm.Model
	Scope       string `gorm:"type:varchar(20);index"`
	UserID      uint   `gorm:"index"`            // 创建者；个人指令的归属人
	Mode        string `gorm:"type:varchar(20)"` // write 帮写 / rewrite 润色
	Label       string `gorm:"type:varchar(100)"`
	Instruction string `gorm:"type:text"` // 交给模型的要求
}

// TableName 显式指定表名，默认命名会把 AIPrompt 拆成 a_iprompts
func (AIPrompt) TableName() string {
	return "ai_prompts"
}

// DefaultAIPrompts 首次启动时写入的平台指令
var DefaultAIPrompts = []AIPrompt{
	{Mode: "write", Label: "续写", Instruction: "根据上下文，在插入点自然地续写。"},
	{Mode: "write", Label: "总结上文", Instruction: "用一段话总结插入点之前的内容，点出要点，不要逐句复述。"},
	{Mode: "write", Label: "整理要点", Instruction: "把插入点之前的内容整理成要点列表，每条一句话。"},
	{Mode: "write", Label: "补充示例", Instruction: "为插入点之前讲到的内容补充一个具体的示例；技术内容优先给出简短的代码示例。"},
	{Mode: "rewrite", Label: "润色", Instruction: "润色选中内容：修正错别字和语病，让表达更通顺、准确，不改变原意和信息量。"},
	{Mode: "rewrite", Label: "精简", Instruction: "精简选中内容：删去重复和冗余的表达，保留全部关键信息，篇幅压缩到原来的一半左右。"},
	{Mode: "rewrite", Label: "扩写", Instruction: "扩写选中内容：补充细节、解释或例子，让内容更充实，但不要编造事实，篇幅扩展到原来的 1.5～2 倍。"},
	{Mode: "rewrite", Label: "更正式", Instruction: "把选中内容改得更正式、书面，适合技术文档或正式文章。"},
	{Mode: "rewrite", Label: "更口语", Instruction: "把选中内容改得更轻松、口语化，像和朋友聊天一样，但保持信息准确。"},
	{Mode: "rewrite", Label: "翻译为英文", Instruction: "把选中内容翻译成英文，保留原有格式，专有名词和代码保持原样。"},
	{Mode: "rewrite", Label: "翻译为中文", Instruction: "把选中内容翻译成简体中文，保留原有格式，专有名词和代码保持原样。"},
}

// ToDto editable 表示当前用户能否编辑、删除该指令
func (p *AIPrompt) ToDto(editable bool) *dto.AIPromptDto {
	return &dto.AIPromptDto{
		ID:          p.ID,
		Scope:       p.Scope,
		Mode:        p.Mode,
		Label:       p.Label,
		Instruction: p.Instruction,
		Editable:    editable,
	}
}
