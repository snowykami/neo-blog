package mcpserver

import (
	"bytes"
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
)

// 正文在库中是富文本编辑器（Tiptap）产出的 HTML；对外部 AI 工具默认以 Markdown 读写，也可直接读写 HTML
const (
	formatMarkdown = "markdown"
	formatHTML     = "html"
)

// 允许在 Markdown 中直接书写 HTML（与编辑者通过接口写入 HTML 的能力一致），渲染时由前端统一净化
var markdownRenderer = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
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

// htmlToMarkdown 存储的 HTML 转为 Markdown 输出
func htmlToMarkdown(content string) (string, error) {
	if strings.TrimSpace(content) == "" {
		return "", nil
	}
	return htmlConverter.ConvertString(content)
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
	}
	if strings.TrimSpace(result) == "" {
		return "<p></p>", nil
	}
	return result, nil
}
