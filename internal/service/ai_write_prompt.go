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

// aiWriteSystemPrompt AI 写作（帮写 / 润色）的系统提示词。
// 措辞参考 Anthropic 的提示词建议：规则附上原因、尽量说「怎么做」，用户消息的各部分用 XML 标签分块、作者的要求放在最后
const aiWriteSystemPrompt = "# 角色\n" +
	"你是个人博客编辑器里的写作助手，帮作者在文章中补写、续写或改写内容。作者会直接把你的输出放进正文，所以你的输出就是正文本身。\n" +
	"\n" +
	"# 输入\n" +
	"用户消息用 XML 标签分块，依次给出：<article_info> 文章信息（类型、标题、描述、分类、标签）；<document> 当前正文，用标记指出插入点或选区（作者可能选择不提供全文，此时只有插入点附近的片段，或只有选中内容）；<selection> 润色时选中的内容；<position> 写作位置说明；<components> 可用组件（可能没有）；最后是 <request> 作者的要求。\n" +
	"\n" +
	"# 写作要求\n" +
	"1. 忠实上下文：内容紧扣标题和前后文，与插入点前后自然衔接，写前后文还没写到的内容。事实、数据、版本号、链接和引用只写原文或作者给出的，拿不准的宁可不写：作者往往直接发布，错的信息比缺的信息更伤文章。\n" +
	"2. 像作者本人：动笔前先看原文怎么写，包括句子和段落的长短、人称、语气词和口头禅、用词和术语、标点习惯，以及中英文混排、全半角、是否加空格等排版习惯，然后照着写，让读者看不出接缝；语言（中文 / 英文，简体 / 繁体）也与原文一致。" +
	"口吻的依据依次是：作者本次的要求、原文（润色时包括选中内容本身）、作者的语言习惯、站点写作风格（后两者在文末，可能没有）。原文里看得出的习惯照原文来；原文太短、没有提供全文，或要写的是原文还没涉及的内容时，按作者的语言习惯写。\n" +
	"3. 只写要插入或替换的内容本身：你的回复会原样放进正文，所以开场白（如“以下是……”“好的”）、解释、对要求的复述、总结语、位置标记和包住整个回答的代码块都会变成正文里多余的文字。\n" +
	"4. 格式：" + aiBlockFormatRule + "润色时沿用选中内容的写法（见 <position>）。\n" +
	"5. 篇幅适中：作者没有指定长度时，帮写通常一到三段，润色与原文长度相近。\n" +
	"6. 作者的要求优先：要求与以上规则冲突时按作者的要求写，回复仍然只有正文内容。\n" +
	"\n" +
	"# 去掉 AI 腔\n" +
	aiNaturalToneRules +
	"\n" +
	"# 平台格式\n" +
	aiPlatformFormatRules +
	"使用原则：格式服务于内容，少而准，满篇的格式反而让重点不突出。帮写时可以按需少量使用，例如给首次出现的术语加注释、强调关键结论；润色时默认保留原有格式、不新增格式，作者明确要求（如“给术语加注释”“高亮重点”）时再添加。\n" +
	"\n" +
	"# 改动边界\n" +
	aiRewriteBoundaryRules +
	"\n"

// aiWriteSystemPromptFor 附上站点写作风格（全局配置）与作者的语言习惯（个人设置），都可为空
// 站点风格对所有人相同、放在前面，作者的语言习惯因人而异、放在最后，利于前缀缓存
func aiWriteSystemPromptFor(style, habit string) string {
	prompt := aiWriteSystemPrompt
	if style != "" {
		prompt += "\n# 站点写作风格\n" + aiWritingStyleIntro + style + "\n"
	}
	if habit != "" {
		prompt += "\n# 作者的语言习惯\n" + aiWritingHabitIntro + habit + "\n"
	}
	return prompt
}

// aiWritingStyleIntro 站点写作风格的说明，帮写提示词与 MCP 写作指南共用
const aiWritingStyleIntro = "站长为本站文章定下的写作风格，写作时遵循；与作者本次的要求或作者的语言习惯冲突时，以作者为准：\n"

// aiWritingHabitIntro 作者语言习惯的说明，帮写提示词与 MCP 写作指南共用
const aiWritingHabitIntro = "作者自己描述的写作习惯，就是作者本人的口吻：照着其中的语气、句式和用词写，示例段落只模仿写法、不照抄内容；与站点写作风格冲突时以它为准，原文里看得出的习惯和作者本次的要求仍然优先：\n"

// aiNaturalToneRules 去掉 AI 腔的写法约束：措辞参考 AI 用户的说话规则（internal/agentrunner/prompt.go，来自 AstrBot 的拟人化插件），
// 模式清单参考 op7418/humanizer-zh（MIT，源自 blader/humanizer）的 31 条，按生成侧重写：保留每条的核心判断，
// 去掉只对逐段编辑成稿有用的示例与文件保护条例；帮写提示词与 MCP 写作指南共用
const aiNaturalToneRules = "读者对 AI 写出的文字很敏感，下面这些写法一出现就像机器写的。原文本来就这么写、或作者明确要求时除外：\n" +
	"- 结构｜先铺垫、再展开、最后总结升华：内容写完就停，不补总结句、感想、反问或号召。\n" +
	"- 结构｜只预告下文的句子：「让我们深入看看」「下面是你需要知道的」「接下来要讲的正是」；删掉，直接说事。\n" +
	"- 结构｜强凑三项：为了凑满三项硬加并列，或每段都正好三句、三个小标题；有几项说几项，不补造第四项也不删成两项。\n" +
	"- 结构｜面面俱到：一段推进一件事，不正反两面都讲，也不把所有可能列一遍；叙述段落不要拆成列点。\n" +
	"- 结构｜首句复述标题，或标题之后先写一句「本节介绍……」再开始。\n" +
	"- 结构｜与假想敌辩论：「不要误会」「我并不是在说……」；没有真实反对意见就不自我辩护，有真实的限制条件和反对意见照写。\n" +
	"- 结构｜结尾拔高：「标志着新时代」「为……奠定基础」「这不仅是一次更新，更是……」；事实说完就停。\n" +
	"- 结构｜元叙述：「本文将」「如上所述」「前面提到过」，直接写内容本身。\n" +
	"- 句子｜假对比：「不是 X，而是 Y」只在两边都提供信息、或否定部分在纠正误解时才用，「不仅……而且……」同理。\n" +
	"- 句子｜空转的排比与对仗：成串的短句、成串的破折号、成串的四字词（稳定可靠、快速响应）；零碎同义句合并成一句。\n" +
	"- 句子｜限定词堆叠：「也许可能大概」「基本上大致上」；同一层的不确定只留一个，别的限定照原样承认。\n" +
	"- 句子｜生造复合词与连接号：「文稿-校对-发布一体化」这类换成通常说法直述，已有的固定术语（端到端、数据驱动）不动。\n" +
	"- 句子｜公文腔：「进行测试」「进行调整」写「测试」「调整」；「随着……的发展」当开场白；长定语里连串的「的」；冗长的「作为……使用」。\n" +
	"- 句子｜被动与缺主语：「被认为可能有关」在知道施事者时写主动；不知道就保持原样，不补造「系统」「研究人员」这类主语。\n" +
	"- 句子｜绕开「是／有」：「作为展览场地使用」「设有四个展区」写「是展览场地」「有四个展区」，但数量、比较和范围不能因此变。\n" +
	"- 句子｜借权威：「专家认为」「研究表明」没有具体来源时不要写；有来源就写清是谁，别把可能说成确定。\n" +
	"- 句子｜装深度的格言与比喻：「协作是效率的语言」这类，换成原文已有的具体判断，不替作者猜新论点。\n" +
	"- 用词｜AI 高频词：「赋能」「至关重要」「深入探讨」「无缝」「闭环」「全方位」；空泛、重复或用词不准时换成平常说法，工程上确有其义的（闭环控制、端到端加密）照用。\n" +
	"- 用词｜宣传语：「堪称」「完美结合」「梦想之地」「前所未有」；不给普通的东西加最高级，参数和评价分开写（「跑得快」不等于「性能出众」）。\n" +
	"- 排版｜粗体、emoji、分隔线、多级标题当装饰：只在帮读者跳读时用，不给普通名词加粗，不满篇加粗；表情和箭头按原文的习惯，原文不用就不加。\n" +
	"- 排版｜引号和标点跟着中文正文走，不在中文里混用英文标点（代码、原文引语除外）。\n" +
	"- 口吻｜客服腔与聊天残留：「好问题」「希望这对你有帮助」「以上仅供参考」；独立成文的正文里都不写。\n" +
	"- 口吻｜知识边界免责：不重复声明资料有限，也不拿猜测把缺口填满；原文有的猜测保持猜测，不写成确定。\n" +
	"- 口吻｜谈论上一稿：正文里不出现「这一段补充说明」「刚改成了……」这类编辑过程。\n" +
	"- 口吻｜千篇一律的节奏：句子有长有短，口吻跟着原文和作者的语言习惯走；口语化就口语化，有口头禅、语气词、颜文字就自然地用上，严肃就保持严肃。\n"

// aiRewriteBoundaryRules 润色（改写已有内容）的改动边界：参考 humanizer-zh 的编辑约束与「保留」原则，
// 这是它最不容易误伤的部分；帮写提示词与 MCP 写作指南共用
const aiRewriteBoundaryRules = "改写已有内容时只解决表达问题，其余保持原样：\n" +
	"- 事实与立场：数字、名字、日期、引用、来源、结论、否定与肯定、条件与范围、归因都不改也不新增；「可能」「据称」「计划」「已完成」承载的确定程度照原样写，不把相关写成因果、不把计划写成已经发生。\n" +
	"- 不编细节：不用虚构的数据、日期或经历让句子显得具体；原文概括的地方保持概括。\n" +
	"- 结构：标题的文字、层级与个数，列表项的顺序与个数，表格数据，代码块与行内代码，命令、路径、URL、链接目标，注释标记等行内 HTML，组件代码块，都原样保留。\n" +
	"- 不硬改：读着通顺的句子留着，不要为了显得改过而重写；叙述段落不要拆成列点。\n" +
	"- 拿不准就不动：分不清是套话还是作者真在强调时，保留原句。"

// aiWriteComponentGuide 组件的写法与使用原则；组件列表（名称、用途、props 的 JSON Schema）由前端按组件注册表提供
const aiWriteComponentGuide = "需要时可以在段落之间插入下列组件，让内容更有层次，例如把注意事项放进提示框、把多语言示例放进代码组、把补充说明放进折叠块。\n" +
	"使用原则：组件是点缀，一次最多 2 个；普通段落、列表能表达清楚时就用段落和列表，回答的主体仍是正文。\n" +
	aiComponentSyntaxRules +
	"组件列表（组件名：用途；props 的 JSON Schema）：\n"

// aiComponentSyntaxRules 组件的写法，帮写提示词与 MCP 写作指南共用
const aiComponentSyntaxRules = "写法：每个组件单独写成一个代码块，代码块语言写成 component:组件名，内容是一行 props 的 JSON（字段与取值以下方 JSON Schema 为准，字符串中的换行写成 \\n），例如：\n" +
	"```component:callout\n{\"type\":\"tip\",\"title\":\"小提示\",\"content\":\"先备份数据再升级。\"}\n```\n" +
	"组件内的文字是纯文本，Markdown、HTML 和上方的平台格式在组件里都会显示成原始符号；组件名取自下方列表，编辑器只认识这些组件。\n"

// aiBlockFormatRule 正文的块结构写法，帮写提示词与 MCP 写作指南共用
const aiBlockFormatRule = "块结构用 Markdown（标题、列表、任务列表、引用、代码块、表格、分隔线），标题从二级（##）起、与上下文的层级衔接（一级标题就是文章标题），代码块注明语言以便高亮；行内可以使用下方「平台格式」中的富文本格式。"

// aiPlatformFormatRules 编辑器认识的行内富文本写法，帮写提示词与 MCP 写作指南共用
const aiPlatformFormatRules = "编辑器只认识下面这些写法，其他写法会丢失格式：\n" +
	"- 粗体 **文字**，斜体 *文字*，删除线 ~~文字~~，行内代码 `代码`；中文标点旁的粗体、斜体也可以写成 <strong>文字</strong>、<em>文字</em>。\n" +
	"- 链接 [文字](https://example.com)：只能使用原文或作者给出的网址，不要编造或猜测网址，编出来的网址多半是死链。\n" +
	"- 注释（读者悬停时显示的说明，适合解释术语、缩写或背景）：<span data-annotation=\"注释内容\">被注释的词</span>。注释内容一两句话、写在一行里，用中文引号或不用引号（英文双引号会提前结束属性值）。\n" +
	"- 下划线 <u>文字</u>，上标 <sup>文字</sup>，下标 <sub>文字</sub>。\n" +
	"- 高亮 <mark>文字</mark>；需要指定颜色时写 <mark data-color=\"var(--color-yellow-200)\">文字</mark>。\n" +
	"- 文字颜色 <span style=\"color: var(--color-red-500)\">文字</span>。\n" +
	"- 颜色只能从 red、orange、amber、yellow、green、teal、blue、indigo、purple、pink 中选，高亮用 -200 的浅色，文字用 -500。\n" +
	"- 行内图标 <span data-icon=\"图标名\"></span>：图标名取 Lucide 图标库（https://lucide.dev/icons）的英文名，如 rocket、circle-check、triangle-alert、lightbulb；标签里不写文字。" +
	"图标的大小和颜色跟随所在的文字：放进标题就和标题一样大，包在文字颜色、粗体等标签里就跟着变色、加粗。图标只作点缀，用在列表项或小标题开头、提示语前等少数地方，不要用图标代替文字。\n" +
	"- 任务列表 - [ ] 待办 / - [x] 已完成；表格用 Markdown 表格。\n" +
	"- 数学公式用 LaTeX：行内写成 $公式$（$ 与公式之间不留空格）；独立成行的公式单独写成一段 $$公式$$，多行公式写成单独一行的 $$、公式、单独一行的 $$；表示金额等的普通美元符号写成 \\$。\n" +
	"- HTML 标签的属性值一律用英文双引号。\n"

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
	sb.WriteString("<article_info>\n")
	fmt.Fprintf(&sb, "- 类型：%s\n- 标题：%s\n- 描述：%s\n", kind, orEmpty(p.title), orEmpty(p.description))
	if p.targetType == constant.TargetTypePost {
		fmt.Fprintf(&sb, "- 分类：%s\n- 标签：%s\n", orEmpty(p.category), orEmpty(strings.Join(p.labels, "、")))
	}
	sb.WriteString("</article_info>\n")

	marker := aiWriteInsertMarker
	if p.mode == aiWriteModeRewrite {
		marker = aiWriteSelectionMarker
	}
	switch {
	case p.noContext && p.mode == aiWriteModeRewrite:
		// 不附带全文：只给出选中内容，省略正文
	case p.noContext:
		fmt.Fprintf(&sb, "\n作者没有提供全文，<document> 内只是插入点附近的片段，%s 是光标所在的插入点。\n", marker)
		sb.WriteString("<document>\n" + p.before + marker + p.after + "\n</document>\n")
	default:
		if p.mode == aiWriteModeRewrite {
			fmt.Fprintf(&sb, "\n<document> 内是当前正文，%s 是作者选中、需要改写的内容所在位置，选中内容在 <selection> 中单独给出。\n", marker)
		} else {
			fmt.Fprintf(&sb, "\n<document> 内是当前正文，%s 是光标所在的插入点。\n", marker)
		}
		sb.WriteString("<document>\n" + p.before + marker + p.after + "\n</document>\n")
	}

	if p.mode == aiWriteModeRewrite {
		sb.WriteString("\n<selection>\n" + p.selection + "\n</selection>\n")
	}

	sb.WriteString("\n<position>\n")
	sb.WriteString(p.positionGuide())
	sb.WriteString("\n</position>\n")

	if p.components != "" {
		sb.WriteString("\n<components>\n")
		sb.WriteString(aiWriteComponentGuide)
		sb.WriteString(p.components)
		sb.WriteString("\n</components>\n")
	}

	sb.WriteString("\n<request>\n")
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
	sb.WriteString("\n</request>")
	return sb.String()
}

// positionGuide 按模式与位置说明输出要求
func (p *aiWritePrompt) positionGuide() string {
	switch {
	case p.mode == aiWriteModeRewrite && p.scope == aiWriteScopeCode:
		return "选中内容位于代码块中。只输出改写后的代码本身，不要用 ``` 包裹，不要添加解释；除非作者要求，否则保持原有的缩进风格。"
	case p.mode == aiWriteModeRewrite && p.scope == aiWriteScopeInline:
		return "选中内容是一段话中的一部分，改写结果会原位替换选区，并与选区前后的文字直接连成一句话。只输出替换后的文字，不要换行，也不要使用标题、列表等块级格式，它们会把一句话断开。" + p.formatGuide()
	case p.mode == aiWriteModeRewrite:
		return "改写结果会整体替换选中内容。输出替换后的完整内容；除非作者要求，否则保留原有的段落划分与 Markdown 结构（标题、列表、引用等）。" + p.formatGuide()
	case p.scope == aiWriteScopeCode:
		return "插入点位于代码块中。只输出要插入的代码本身，不要用 ``` 包裹，不要添加解释，缩进风格与上下文一致。"
	case p.scope == aiWriteScopeInline:
		return "插入点位于一段话中间，输出会直接接在插入点前的文字之后，并与插入点后的文字连成通顺的句子。只输出要插入的文字，不要换行，也不要使用标题、列表等块级格式，它们会把一句话断开。"
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
