package dto

// AIWriteReq 编辑器 AI 写作（帮写 / 润色）请求
// 正文与元信息取自编辑器当前内容（可能尚未保存），插入点与选区在正文中以标记文本表示
type AIWriteReq struct {
	Mode        string `json:"mode"`        // write 帮写 / rewrite 润色
	Scope       string `json:"scope"`       // block 独立成块 / inline 段落中间 / code 代码块内
	Preset      string `json:"preset"`      // 快捷指令，如 polish、translate_en，可与 Instruction 同时提供
	Instruction string `json:"instruction"` // 用户的要求，可为空（帮写为续写，润色为润色）
	Document    string `json:"document"`    // 正文 HTML，含插入点或选区标记
	// Selection 润色选区的格式化表示：块结构为 Markdown，行内格式为 HTML 标签，图片等不可改写的节点为 [[KEEP_n]] 占位符
	// 提供时原样交给模型（不再从正文中提取纯文本），以便保留格式；代码块内的选区不使用
	Selection string `json:"selection"`
	// IncludeContext 是否附带全文作为上下文；不附带时润色只给出选中内容，帮写只给出插入点附近的片段，提示词更精简
	IncludeContext bool     `json:"include_context"`
	Title          string   `json:"title"`
	Description    string   `json:"description"`
	Category       string   `json:"category"`
	Labels         []string `json:"labels"`
}
