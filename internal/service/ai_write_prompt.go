package service

import (
	"fmt"
	"strings"

	"github.com/snowykami/neo-blog/pkg/constant"
)

// 正文中的位置标记：前端在编辑器内容的插入点 / 选区两端插入这些文本后提交
const (
	aiWriteInsertMarker    = "[[INSERT_HERE]]"
	aiWriteSelectionStart  = "[[SELECTION_START]]"
	aiWriteSelectionEnd    = "[[SELECTION_END]]"
	aiWriteSelectionMarker = "[[SELECTION]]" // 提示词中选区的占位，选中内容单独给出
)

const (
	aiWriteModeWrite   = "write"
	aiWriteModeRewrite = "rewrite"

	aiWriteScopeBlock  = "block"
	aiWriteScopeInline = "inline"
	aiWriteScopeCode   = "code"
)

// aiWriteSystemPrompt AI 写作（帮写 / 润色）的系统提示词
const aiWriteSystemPrompt = "# 角色\n" +
	"你是个人博客编辑器里的写作助手，帮作者在文章中补写、续写或改写内容。作者会直接把你的输出放进正文，所以你的输出就是正文本身。\n" +
	"\n" +
	"# 输入\n" +
	"用户消息依次给出：文章信息（类型、标题、描述、分类、标签）、当前正文（用标记指出插入点或选区；作者可能选择不提供全文，此时只有选中内容或插入点附近的片段）、写作位置说明、作者的要求。\n" +
	"\n" +
	"# 写作要求\n" +
	"1. 忠实上下文：内容要紧扣标题和前后文，与插入点前后自然衔接，不重复前后文已经写过的内容；不编造原文没有依据的事实、数据、版本号、链接或引用，拿不准的信息宁可不写。\n" +
	"2. 风格一致：沿用原文的语言（中文 / 英文，简体 / 繁体）、人称、语气、用词和术语；中英文混排、标点全半角、是否加空格等排版习惯也与原文保持一致。\n" +
	"3. 只输出要插入或替换的内容：不要解释、寒暄或复述要求，不要加“以下是……”“好的”之类的引导语和总结语，不要输出任何位置标记，不要用代码块包裹整个回答。\n" +
	"4. 格式：块结构用 Markdown（标题、列表、任务列表、引用、代码块、表格、分隔线），标题层级与上下文衔接，不要输出一级标题（#），代码块注明语言；行内可以使用下方「平台格式」中的富文本格式。润色时沿用选中内容的写法（见写作位置说明）。\n" +
	"5. 篇幅适中：作者没有指定长度时，帮写通常一到三段，润色与原文长度相近。\n" +
	"6. 作者的要求优先：要求与以上规则冲突时按作者的要求写，但仍然只输出正文内容。\n" +
	"\n" +
	"# 平台格式\n" +
	"编辑器只认识下面这些写法，其他写法会丢失格式：\n" +
	"- 粗体 **文字**，斜体 *文字*，删除线 ~~文字~~，行内代码 `代码`；中文标点旁的粗体、斜体也可以写成 <strong>文字</strong>、<em>文字</em>。\n" +
	"- 链接 [文字](https://example.com)：只能使用原文或作者给出的网址，不要编造或猜测网址。\n" +
	"- 注释（读者悬停时显示的说明，适合解释术语、缩写或背景）：<span data-annotation=\"注释内容\">被注释的词</span>。注释内容一两句话，不换行，不含英文双引号。\n" +
	"- 下划线 <u>文字</u>，上标 <sup>文字</sup>，下标 <sub>文字</sub>。\n" +
	"- 高亮 <mark>文字</mark>；需要指定颜色时写 <mark data-color=\"var(--color-yellow-200)\">文字</mark>。\n" +
	"- 文字颜色 <span style=\"color: var(--color-red-500)\">文字</span>。\n" +
	"- 颜色只能从 red、orange、amber、yellow、green、teal、blue、indigo、purple、pink 中选，高亮用 -200 的浅色，文字用 -500。\n" +
	"- 任务列表 - [ ] 待办 / - [x] 已完成；表格用 Markdown 表格。\n" +
	"- HTML 标签的属性值一律用英文双引号。\n" +
	"使用原则：格式服务于内容，宁少勿滥。帮写时可以按需少量使用，例如给首次出现的术语加注释、强调关键结论；润色时默认保留原有格式、不新增格式，作者明确要求（如“给术语加注释”“高亮重点”）时再添加。\n"

// aiWriteComponentGuide 组件的写法与使用原则；组件列表（名称、用途、props 的 JSON Schema）由前端按组件注册表提供
const aiWriteComponentGuide = "需要时可以在段落之间插入下列组件，让内容更有层次，例如把注意事项放进提示框、把多语言示例放进代码组、把补充说明放进折叠块。\n" +
	"使用原则：宁少勿滥，一次最多使用 2 个；普通段落、列表能表达清楚时不要使用；不要把整段回答都放进组件。\n" +
	"写法：每个组件单独写成一个代码块，代码块语言写成 component:组件名，内容是一行 props 的 JSON（字段与取值以下方 JSON Schema 为准，字符串中的换行写成 \\n），例如：\n" +
	"```component:callout\n{\"type\":\"tip\",\"title\":\"小提示\",\"content\":\"先备份数据再升级。\"}\n```\n" +
	"组件内的文字是纯文本，不支持 Markdown、HTML 和上方的平台格式；组件名必须来自下方列表。\n" +
	"组件列表（组件名：用途；props 的 JSON Schema）：\n"

// aiWritePrompt 构建 AI 写作用户消息所需的信息
type aiWritePrompt struct {
	targetType  string
	mode        string
	scope       string
	preset      string // 快捷指令的要求内容
	instruction string
	title       string
	description string
	category    string
	labels      []string
	before      string // 插入点 / 选区之前的正文（纯文本，已截断）
	after       string // 插入点 / 选区之后的正文（纯文本，已截断）
	selection   string // 润色：选中的内容
	structured  bool   // 选中内容为保留格式的标记文本（Markdown + 行内 HTML 标签 + 占位符）
	noContext   bool   // 作者选择不附带全文：润色不给正文，帮写只给插入点附近的片段
	components  string // 独立成块的帮写可用的组件说明，为空时不允许使用组件
}

// splitAIWriteDocument 把带标记的正文纯文本拆成前文、选区与后文
// 帮写需要恰好一个插入点标记；润色需要依次出现选区开始与结束标记
func splitAIWriteDocument(text, mode string) (before, selection, after string, ok bool) {
	if mode == aiWriteModeWrite {
		if strings.Count(text, aiWriteInsertMarker) != 1 {
			return "", "", "", false
		}
		before, after, _ = strings.Cut(text, aiWriteInsertMarker)
		return before, "", after, true
	}
	if strings.Count(text, aiWriteSelectionStart) != 1 || strings.Count(text, aiWriteSelectionEnd) != 1 {
		return "", "", "", false
	}
	before, rest, _ := strings.Cut(text, aiWriteSelectionStart)
	selection, after, found := strings.Cut(rest, aiWriteSelectionEnd)
	if !found {
		return "", "", "", false
	}
	return before, selection, after, true
}

// truncateAIWriteContext 前后文总长超出上限时，保留离插入点最近的部分：前文保留结尾、后文保留开头
// 前文默认占 2/3 的额度，一侧较短时把剩余额度让给另一侧
func truncateAIWriteContext(before, after string, limit int) (string, string) {
	b, a := []rune(before), []rune(after)
	if len(b)+len(a) <= limit {
		return before, after
	}
	keepBefore := min(len(b), limit*2/3)
	keepAfter := min(len(a), limit-keepBefore)
	keepBefore = min(len(b), limit-keepAfter)
	if keepBefore < len(b) {
		before = "……（前文省略）……\n" + string(b[len(b)-keepBefore:])
	}
	if keepAfter < len(a) {
		after = string(a[:keepAfter]) + "\n……（后文省略）……"
	}
	return before, after
}

func orEmpty(s string) string {
	if strings.TrimSpace(s) == "" {
		return "（无）"
	}
	return strings.TrimSpace(s)
}

// build 生成用户消息
func (p *aiWritePrompt) build() string {
	var sb strings.Builder
	kind := "文章"
	if p.targetType == constant.TargetTypePage {
		kind = "独立页面"
	}
	sb.WriteString("# 文章信息\n")
	fmt.Fprintf(&sb, "- 类型：%s\n- 标题：%s\n- 描述：%s\n", kind, orEmpty(p.title), orEmpty(p.description))
	if p.targetType == constant.TargetTypePost {
		fmt.Fprintf(&sb, "- 分类：%s\n- 标签：%s\n", orEmpty(p.category), orEmpty(strings.Join(p.labels, "、")))
	}

	marker := aiWriteInsertMarker
	if p.mode == aiWriteModeRewrite {
		marker = aiWriteSelectionMarker
	}
	switch {
	case p.noContext && p.mode == aiWriteModeRewrite:
		// 不附带全文：只给出选中内容，省略正文
	case p.noContext:
		sb.WriteString("\n# 插入点附近的正文\n")
		fmt.Fprintf(&sb, "作者没有提供全文，以下只是插入点附近的片段，%s 是光标所在的插入点。\n", marker)
		sb.WriteString("<<<\n" + p.before + marker + p.after + "\n>>>\n")
	default:
		sb.WriteString("\n# 当前正文\n")
		if p.mode == aiWriteModeRewrite {
			fmt.Fprintf(&sb, "正文中的 %s 是作者选中、需要改写的内容所在位置，选中内容在下一节单独给出。\n", marker)
		} else {
			fmt.Fprintf(&sb, "正文中的 %s 是光标所在的插入点。\n", marker)
		}
		sb.WriteString("<<<\n" + p.before + marker + p.after + "\n>>>\n")
	}

	if p.mode == aiWriteModeRewrite {
		sb.WriteString("\n# 选中内容\n<<<\n" + p.selection + "\n>>>\n")
	}

	sb.WriteString("\n# 写作位置\n")
	sb.WriteString(p.positionGuide())

	if p.components != "" {
		sb.WriteString("\n\n# 可用组件\n")
		sb.WriteString(aiWriteComponentGuide)
		sb.WriteString(p.components)
	}

	sb.WriteString("\n\n# 作者的要求\n")
	instruction := strings.TrimSpace(p.instruction)
	if preset := strings.TrimSpace(p.preset); preset != "" {
		if instruction != "" {
			instruction = preset + "\n补充要求：" + instruction
		} else {
			instruction = preset
		}
	}
	if instruction == "" {
		if p.mode == aiWriteModeRewrite {
			instruction = "润色选中内容：修正错别字和语病，让表达更通顺、准确，不改变原意和信息量。"
		} else {
			instruction = "根据上下文，在插入点自然地续写。"
		}
	}
	sb.WriteString(instruction)
	return sb.String()
}

// positionGuide 按模式与位置说明输出要求
func (p *aiWritePrompt) positionGuide() string {
	switch {
	case p.mode == aiWriteModeRewrite && p.scope == aiWriteScopeCode:
		return "选中内容位于代码块中。只输出改写后的代码本身，不要用 ``` 包裹，不要添加解释；除非作者要求，否则保持原有的缩进风格。"
	case p.mode == aiWriteModeRewrite && p.scope == aiWriteScopeInline:
		return "选中内容是一段话中的一部分，改写结果会原位替换选区，并与选区前后的文字直接连成一句话。只输出替换后的文字，不要换行，不要使用标题、列表等块级格式。" + p.formatGuide()
	case p.mode == aiWriteModeRewrite:
		return "改写结果会整体替换选中内容。输出替换后的完整内容；除非作者要求，否则保留原有的段落划分与 Markdown 结构（标题、列表、引用等）。" + p.formatGuide()
	case p.scope == aiWriteScopeCode:
		return "插入点位于代码块中。只输出要插入的代码本身，不要用 ``` 包裹，不要添加解释，缩进风格与上下文一致。"
	case p.scope == aiWriteScopeInline:
		return "插入点位于一段话中间，输出会直接接在插入点前的文字之后，并与插入点后的文字连成通顺的句子。只输出要插入的文字，不要换行，不要使用标题、列表等块级格式。"
	default:
		return "输出会作为独立的段落插入到插入点处，可以是一段或多段，并与前后段落自然衔接。"
	}
}

// formatGuide 润色带格式的选区时，说明格式写法与保留规则
func (p *aiWritePrompt) formatGuide() string {
	if !p.structured {
		return ""
	}
	return "\n\n选中内容的格式写法：块结构用 Markdown；行内格式用 HTML 标签表示，如 <strong>、<em>、<s>、<code>、<u>、<mark>、<sub>、<sup>；" +
		"<m1>、<m2> 这类编号标签代表带属性的格式（注释、链接、颜色、高亮等）；带对齐方式的段落整段写成 HTML（如 <p style=\"text-align: center\">…</p>）；" +
		"文字中的反斜杠是 Markdown 转义，&lt; 等是 HTML 实体。输出时沿用同样的写法：\n" +
		"1. 保留格式：每个标签（包括编号标签的编号与属性里的英文引号）原样保留，继续包住改写后对应的文字（可随措辞调整包住的范围）；不要删除、合并或新增格式，除非作者要求。\n" +
		"2. 保留占位符：[[KEEP_1]] 这类占位符代表图片、代码块、表格等不能改动的内容，必须原样输出在对应的位置，不要修改、删除、复制或用代码块包裹。\n" +
		"3. 保留结构：段落、标题、列表项、引用与原文一一对应；原文是一段的仍输出为一段，不要因为标签或占位符换行、拆段；带 HTML 的段落仍写成 HTML，不要改成 Markdown。"
}
