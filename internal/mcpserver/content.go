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
	// 站内组件块（<div data-component=...>）在 Markdown 中没有对应语法，原样保留为 HTML，写回时不会丢失
	conv.Register.Renderer(func(ctx converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
		if _, ok := dom.GetAttribute(n, "data-component"); !ok {
			return converter.RenderTryNext
		}
		var buf bytes.Buffer
		if err := html.Render(&buf, n); err != nil {
			return converter.RenderTryNext
		}
		// Markdown 的 HTML 块遇到空行即结束，去掉内部空行保证写回时整体仍是一个块
		w.WriteString("\n\n" + reBlankLines.ReplaceAllString(buf.String(), "\n") + "\n\n")
		return converter.RenderSuccess
	}, converter.PriorityEarly)
	return conv
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
	}
	if strings.TrimSpace(result) == "" {
		return "<p></p>", nil
	}
	return result, nil
}
