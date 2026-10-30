package service

import (
	"strings"

	"github.com/snowykami/neo-blog/internal/tools"
)

// BuildAgentWritingGuide 外部 AI 工具（MCP）的写作指南：站点写作风格、正文格式与可用组件
// 格式规则与编辑器 AI 帮写共用同一份说明；componentList 由调用方按组件清单生成，为空时不介绍组件
func BuildAgentWritingGuide(componentList string) string {
	var sb strings.Builder
	sb.WriteString("# 写作指南\n")
	sb.WriteString("用 create_post / update_post 撰写或修改正文（content_format 为 markdown）时遵循以下规则。正文会被转换成站点编辑器的格式，读者看到的排版取决于这里的写法。\n")
	if style := tools.GetAIWritingStyle(); style != "" {
		sb.WriteString("\n## 站点写作风格\n")
		sb.WriteString(aiWritingStyleIntro)
		sb.WriteString(style)
		sb.WriteString("\n")
	}
	sb.WriteString("\n## 正文结构\n")
	sb.WriteString(aiBlockFormatRule)
	sb.WriteString("\n修改已有文章时，沿用原文的语言、人称、语气和排版习惯，保留原有格式，只改需要改的地方。\n")
	sb.WriteString("\n## 平台格式\n")
	sb.WriteString(aiPlatformFormatRules)
	sb.WriteString("使用原则：格式服务于内容，少而准，满篇的格式反而让重点不突出。\n")
	if componentList != "" {
		sb.WriteString("\n## 组件\n")
		sb.WriteString("需要时可以在段落之间插入下列组件，让内容更有层次，例如把注意事项放进提示框、把多语言示例放进代码组、把补充说明放进折叠块。\n")
		sb.WriteString("使用原则：组件是点缀，普通段落、列表能表达清楚时就用段落和列表。\n")
		sb.WriteString(aiComponentSyntaxRules)
		sb.WriteString("get_post 以 markdown 读取时，文章中的这些组件也以同样的代码块给出，修改时保持该写法即可；其他组件以原始 HTML 给出，原样保留。\n")
		sb.WriteString("组件名不存在或 props 不符合 JSON Schema 时，整次写入会被拒绝并说明原因，按提示修正后重试。\n")
		sb.WriteString("组件列表（组件名：用途；props 的 JSON Schema）：\n")
		sb.WriteString(componentList)
		sb.WriteString("\n")
	}
	return sb.String()
}
