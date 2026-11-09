package mcpserver

import (
	"bytes"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/JohannesKaufmann/dom"
	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/base"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/commonmark"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/strikethrough"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/table"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	goldmarkhtml "github.com/yuin/goldmark/renderer/html"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// 正文在库中是富文本编辑器（Tiptap）产出的 HTML；对外部 AI 工具默认以 Markdown 读写，也可直接读写 HTML
const (
	formatMarkdown = "markdown"
	formatHTML     = "html"
)

// 允许在 Markdown 中直接书写 HTML（与编辑者通过接口写入 HTML 的能力一致），渲染时由前端统一净化；
// $…$ / $$…$$ 转为编辑器的公式节点
var markdownRenderer = goldmark.New(
	goldmark.WithExtensions(extension.GFM, &mathExtension{}),
	goldmark.WithRendererOptions(goldmarkhtml.WithUnsafe()),
)

var htmlConverter = newHTMLConverter()

var reBlankLines = regexp.MustCompile(`\n\s*\n`)

func newHTMLConverter() *converter.Converter {
	conv := converter.NewConverter(converter.WithPlugins(
		base.NewBasePlugin(),
		commonmark.NewCommonmarkPlugin(),
		strikethrough.NewStrikethroughPlugin(),
		table.NewTablePlugin(),
	))
	// 公式与图标节点没有子节点，空白折叠时会被当作不存在而吞掉后面的空格：先填入占位文字（输出时只读属性）
	conv.Register.PreRenderer(func(ctx converter.Context, doc *html.Node) {
		for _, n := range dom.FindAllNodes(doc, isMathElement) {
			if latex, _ := dom.GetAttribute(n, "data-latex"); n.FirstChild == nil && latex != "" {
				n.AppendChild(&html.Node{Type: html.TextNode, Data: latex})
			}
		}
		for _, n := range dom.FindAllNodes(doc, isIconElement) {
			if name, _ := dom.GetAttribute(n, iconAttr); n.FirstChild == nil && name != "" {
				n.AppendChild(&html.Node{Type: html.TextNode, Data: name})
				n.Attr = append(n.Attr, html.Attribute{Key: iconPlaceholderAttr})
			}
		}
	}, converter.PriorityStandard)
	// 图标输出为空的 <span data-icon="…"></span>（与写入时的写法一致）；需先于下方「带属性的 span 原样保留」处理
	conv.Register.Renderer(func(ctx converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
		if !isIconElement(n) {
			return converter.RenderTryNext
		}
		if _, ok := dom.GetAttribute(n, iconPlaceholderAttr); !ok {
			return converter.RenderTryNext
		}
		attrs := n.Attr[:0:0]
		for _, attr := range n.Attr {
			if attr.Key != iconPlaceholderAttr {
				attrs = append(attrs, attr)
			}
		}
		w.WriteString(openTag(&html.Node{Data: n.Data, Attr: attrs}) + "</span>")
		return converter.RenderSuccess
	}, converter.PriorityEarly-10)
	// 公式节点输出为 $…$ / $$…$$；需先于下方「带属性的 span 原样保留」处理
	conv.Register.Renderer(func(ctx converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
		if !isMathElement(n) {
			return converter.RenderTryNext
		}
		nodeType, _ := dom.GetAttribute(n, "data-type")
		latex, _ := dom.GetAttribute(n, "data-latex")
		var next byte
		if n.NextSibling != nil && n.NextSibling.Type == html.TextNode && n.NextSibling.Data != "" {
			next = n.NextSibling.Data[0]
		}
		markdown, ok := mathMarkdown(nodeType, latex, next)
		if !ok {
			return converter.RenderTryNext
		}
		w.WriteString(markdown)
		return converter.RenderSuccess
	}, converter.PriorityEarly-10)
	// 正文中的 $ 一律转义为 \$，写回时不会被当作公式的分隔符
	conv.Register.UnEscaper(func(chars []byte, index int) int {
		if chars[index] == '$' {
			return 1
		}
		return -1
	}, converter.PriorityStandard)
	// 图片 / 视频块：注释、宽度、对齐存在 figure 上（或带布局属性的 img），Markdown 没有对应语法，
	// 原样保留为 HTML 块，写回时由编辑器的 figure 解析规则还原；无这些属性的图片仍按 Markdown 图片输出
	keepMediaBlock := func(ctx converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
		if !isMediaBlock(n) {
			return converter.RenderTryNext
		}
		var buf bytes.Buffer
		if err := html.Render(&buf, n); err != nil {
			return converter.RenderTryNext
		}
		// Markdown 的 HTML 块遇到空行即结束，去掉内部空行保证写回时整体仍是一个块
		w.WriteString("\n\n" + reBlankLines.ReplaceAllString(buf.String(), "\n") + "\n\n")
		return converter.RenderSuccess
	}
	conv.Register.Renderer(keepMediaBlock, converter.PriorityEarly)
	// 站内组件块（<div data-component=...>）：对 AI 开放的组件输出为组件代码块（与写入时的写法一致），
	// 其余组件在 Markdown 中没有对应语法，原样保留为 HTML，写回时不会丢失
	conv.Register.Renderer(func(ctx converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
		name, ok := dom.GetAttribute(n, "data-component")
		if !ok {
			return converter.RenderTryNext
		}
		attrs := make(map[string]string, len(n.Attr))
		for _, attr := range n.Attr {
			attrs[attr.Key] = attr.Val
		}
		if fence, ok := componentFence(name, attrs["data-version"], attrs["data-props"], attrs); ok {
			w.WriteString("\n\n" + fence + "\n\n")
			return converter.RenderSuccess
		}
		var buf bytes.Buffer
		if err := html.Render(&buf, n); err != nil {
			return converter.RenderTryNext
		}
		// Markdown 的 HTML 块遇到空行即结束，去掉内部空行保证写回时整体仍是一个块
		w.WriteString("\n\n" + reBlankLines.ReplaceAllString(buf.String(), "\n") + "\n\n")
		return converter.RenderSuccess
	}, converter.PriorityEarly)
	// 编辑器的行内格式（注释、高亮、文字颜色、下划线、上下标）在 Markdown 中没有对应语法：标签原样保留，
	// 标签内的文字仍按 Markdown 输出（会被正确转义），写回时由 Markdown 中的行内 HTML 还原
	conv.Register.Renderer(func(ctx converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
		if !keepInlineTag(n) {
			return converter.RenderTryNext
		}
		w.WriteString(openTag(n))
		ctx.RenderChildNodes(ctx, w, n)
		w.WriteString("</" + n.Data + ">")
		return converter.RenderSuccess
	}, converter.PriorityEarly)
	// 带对齐等样式的段落与标题整段保留为 HTML 块
	conv.Register.Renderer(func(ctx converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
		if !keepStyledBlock(n) {
			return converter.RenderTryNext
		}
		var buf bytes.Buffer
		if err := html.Render(&buf, n); err != nil {
			return converter.RenderTryNext
		}
		w.WriteString("\n\n" + strings.ReplaceAll(buf.String(), "\n", " ") + "\n\n")
		return converter.RenderSuccess
	}, converter.PriorityEarly)
	return conv
}

func keepInlineTag(n *html.Node) bool {
	if n.Type != html.ElementNode {
		return false
	}
	switch n.Data {
	case "mark", "u", "sup", "sub":
		return true
	case "span":
		return len(n.Attr) > 0
	}
	return false
}

func keepStyledBlock(n *html.Node) bool {
	if n.Type != html.ElementNode {
		return false
	}
	switch n.Data {
	case "p", "h1", "h2", "h3", "h4", "h5", "h6":
		_, ok := dom.GetAttribute(n, "style")
		return ok
	}
	return false
}

// isMediaBlock 带注释 / 宽度 / 对齐的媒体块：编辑器输出的 <figure> 包裹的图片与视频，
// 以及带布局属性的单独 <img>。这些属性在 Markdown 里没有对应语法，需要整块保留
func isMediaBlock(n *html.Node) bool {
	if n.Type != html.ElementNode {
		return false
	}
	switch n.Data {
	case "figure":
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			if child.Type == html.ElementNode && (child.Data == "img" || child.Data == "video") {
				return true
			}
		}
		return false
	case "img":
		for _, key := range []string{"data-width", "data-align"} {
			if _, ok := dom.GetAttribute(n, key); ok {
				return true
			}
		}
		return false
	}
	return false
}

// openTag 输出元素的开始标签，属性值一律用双引号并转义
func openTag(n *html.Node) string {
	var sb strings.Builder
	sb.WriteString("<" + n.Data)
	for _, attr := range n.Attr {
		sb.WriteString(" " + attr.Key + `="` + html.EscapeString(attr.Val) + `"`)
	}
	sb.WriteString(">")
	return sb.String()
}

// normalizeFormat 未指定时默认为 Markdown
func normalizeFormat(format string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", formatMarkdown:
		return formatMarkdown, nil
	case formatHTML:
		return formatHTML, nil
	}
	return "", fmt.Errorf("content_format must be %q or %q", formatMarkdown, formatHTML)
}

// htmlToMarkdown 存储的 HTML 转为 Markdown 输出（按顶层块转换，见 htmlToMarkdownBlocks）
func htmlToMarkdown(content string) (string, error) {
	markdown, _, err := htmlToMarkdownBlocks(content)
	return markdown, err
}

// markdownBlock 正文的一个顶层节点，以及它在 Markdown 全文中的位置 [from, to)；空节点（空段落、空白文本）from == to
type markdownBlock struct {
	node     *html.Node
	from, to int
}

// 相邻的同类列表之间的分隔：Markdown 中只隔一个空行的两个列表会被解析成同一个列表（与转换器整篇转换时的写法一致）
const markdownListSeparator = "<!--THE END-->"

// htmlToMarkdownBlocks 把正文按顶层块分别转换为 Markdown，块之间以空行分隔，返回全文与每个顶层节点的位置
// get_post 的输出与 patch 的查找使用同一份结果：find_text 照抄 get_post 的内容即可命中，命中的位置也能对应回顶层块
func htmlToMarkdownBlocks(content string) (string, []markdownBlock, error) {
	if strings.TrimSpace(content) == "" {
		return "", nil, nil
	}
	nodes, err := html.ParseFragment(strings.NewReader(content), &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body})
	if err != nil {
		return "", nil, err
	}
	var sb strings.Builder
	blocks := make([]markdownBlock, 0, len(nodes))
	var prev *html.Node
	for _, n := range nodes {
		md := ""
		if n.Type == html.ElementNode {
			var buf bytes.Buffer
			if err := html.Render(&buf, n); err != nil {
				return "", nil, err
			}
			if md, err = htmlConverter.ConvertString(buf.String()); err != nil {
				return "", nil, err
			}
			md = strings.TrimSpace(md)
		}
		if md == "" {
			blocks = append(blocks, markdownBlock{node: n, from: sb.Len(), to: sb.Len()})
			continue
		}
		if sb.Len() > 0 {
			sb.WriteString("\n\n")
			if prev != nil && (n.DataAtom == atom.Ul || n.DataAtom == atom.Ol) && prev.DataAtom == n.DataAtom {
				sb.WriteString(markdownListSeparator + "\n\n")
			}
		}
		from := sb.Len()
		sb.WriteString(md)
		blocks = append(blocks, markdownBlock{node: n, from: from, to: sb.Len()})
		prev = n
	}
	return sb.String(), blocks, nil
}

func renderNodes(blocks []markdownBlock) (string, error) {
	var buf bytes.Buffer
	for _, b := range blocks {
		if err := html.Render(&buf, b.node); err != nil {
			return "", err
		}
	}
	return buf.String(), nil
}

// findUnique 在 text 中查找 find，必须恰好出现一次
func findUnique(text, find string) (int, error) {
	switch n := strings.Count(text, find); {
	case strings.TrimSpace(find) == "":
		return 0, errors.New("find_text must not be empty")
	case n == 0:
		return 0, errors.New("find_text was not found in the current draft: someone may have changed that part, or the text was not copied exactly. Call get_post (same content_format) and copy the text verbatim")
	case n > 1:
		return 0, fmt.Errorf("find_text matches %d places in the draft; include more of the surrounding text so it matches exactly one", n)
	}
	return strings.Index(text, find), nil
}

// applyMarkdownPatch 在正文的 Markdown 中查找 findText（必须唯一），只把命中的顶层块换成替换后的 Markdown 转出的 HTML，
// 其余块保持原样（包括 Markdown 表达不了的格式）；返回新的 HTML 与替换后这几个块的 Markdown（供调用方核对）
func applyMarkdownPatch(content, findText, replacement string) (string, string, error) {
	markdown, blocks, err := htmlToMarkdownBlocks(content)
	if err != nil {
		return "", "", fmt.Errorf("failed to convert content: %w", err)
	}
	start, err := findUnique(markdown, findText)
	if err != nil {
		return "", "", err
	}
	end := start + len(findText)
	first, last := -1, -1
	for i, b := range blocks {
		if b.to > b.from && b.to > start && b.from < end {
			if first < 0 {
				first = i
			}
			last = i
		}
	}
	if first < 0 {
		return "", "", errors.New("find_text must include some of the post's text, not only blank lines")
	}
	regionFrom, regionTo := blocks[first].from, blocks[last].to
	region := markdown[regionFrom:start] + replacement + markdown[end:regionTo]
	regionHTML := ""
	if strings.TrimSpace(region) != "" {
		if regionHTML, err = parseContent(region, formatMarkdown); err != nil {
			return "", "", err
		}
	}
	before, err := renderNodes(blocks[:first])
	if err != nil {
		return "", "", err
	}
	after, err := renderNodes(blocks[last+1:])
	if err != nil {
		return "", "", err
	}
	result := before + regionHTML + after
	if strings.TrimSpace(result) == "" {
		result = emptyContentHTML
	}
	return result, strings.TrimSpace(region), nil
}

// markdownToHTML Markdown 输入转为编辑器可加载的 HTML
func markdownToHTML(source string) (string, error) {
	var buf bytes.Buffer
	if err := markdownRenderer.Convert([]byte(source), &buf); err != nil {
		return "", err
	}
	return strings.TrimSpace(buf.String()), nil
}

// renderContent 按格式输出正文
func renderContent(content, format string) (string, error) {
	if format == formatHTML {
		return content, nil
	}
	return htmlToMarkdown(content)
}

// parseContent 按格式解析输入的正文为 HTML；空正文存为空段落，与编辑器保持一致
func parseContent(content, format string) (string, error) {
	result := content
	if format == formatMarkdown {
		var err error
		if result, err = markdownToHTML(content); err != nil {
			return "", fmt.Errorf("failed to convert markdown: %w", err)
		}
		if result, err = convertComponentFences(result); err != nil {
			return "", fmt.Errorf("invalid component: %w (call get_writing_guide for the component list and props schemas)", err)
		}
		result = normalizeIconTags(result)
		if err = validateIcons(result); err != nil {
			return "", fmt.Errorf("invalid icon: %w (call get_writing_guide for the icon syntax)", err)
		}
	}
	if strings.TrimSpace(result) == "" {
		return "<p></p>", nil
	}
	return result, nil
}
