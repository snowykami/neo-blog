package mcpserver

import (
	_ "embed"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/JohannesKaufmann/dom"
	"golang.org/x/net/html"
)

// 行内图标：编辑器存为 <span data-icon="图标名"></span>（不含文字与 SVG，前台按图标名渲染，规则见 web/src/lib/inline-icon/constants.ts），
// Markdown 中原样写成这个标签。
// 图标名清单由前端测试根据已安装的 lucide 生成（web/src/lib/inline-icon/icon.test.ts，含别名）；
// 升级 lucide-react 后在 web 目录运行 pnpm test -u 更新
//
//go:embed lucide-icons.txt
var lucideIconList string

const iconAttr = "data-icon"

// 转 Markdown 时给空的图标标记填入占位文字后打上的标记属性（只在转换过程中存在）
const iconPlaceholderAttr = "data-mcp-icon-placeholder"

var lucideIcons = strings.Fields(lucideIconList)

func isKnownIcon(name string) bool {
	_, found := slices.BinarySearch(lucideIcons, name)
	return found
}

// isIconElement 图标标记：带 data-icon 的 span（是否为空由调用方判断）
func isIconElement(n *html.Node) bool {
	if n.Type != html.ElementNode || n.Data != "span" {
		return false
	}
	_, ok := dom.GetAttribute(n, iconAttr)
	return ok
}

// 自闭合的图标标签（<span data-icon="x"/>）在 HTML 中不会自闭合，会把后面的文字都包进去：写入前补成成对的空标签
var reSelfClosingIcon = regexp.MustCompile(`<span(\s[^<>]*?\bdata-icon="[^"]*"[^<>]*?)\s*/>`)

func normalizeIconTags(content string) string {
	if !strings.Contains(content, iconAttr) {
		return content
	}
	return reSelfClosingIcon.ReplaceAllString(content, "<span$1></span>")
}

// validateIcons 校验写入的图标标记：必须是空标签，图标名必须是 lucide 的图标名，出错时说明正确写法
func validateIcons(content string) error {
	if !strings.Contains(content, iconAttr) {
		return nil
	}
	doc, err := html.Parse(strings.NewReader(content))
	if err != nil {
		return err
	}
	var unknown []string
	for _, n := range dom.FindAllNodes(doc, isIconElement) {
		name, _ := dom.GetAttribute(n, iconAttr)
		if strings.TrimSpace(dom.CollectText(n)) != "" {
			return fmt.Errorf(`icon tag <span data-icon=%q> must be empty: write <span data-icon=%q></span> and put any text outside it`, name, name)
		}
		if !isKnownIcon(name) && !slices.Contains(unknown, name) {
			unknown = append(unknown, name)
		}
	}
	if len(unknown) > 0 {
		for i, name := range unknown {
			unknown[i] = strconv.Quote(name)
		}
		return fmt.Errorf("unknown icon name %s: use a Lucide icon name from https://lucide.dev/icons in kebab-case, e.g. rocket, circle-check, triangle-alert, lightbulb", strings.Join(unknown, ", "))
	}
	return nil
}
