package utils

import (
	"strings"
	"unicode"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// HTMLExcerpt 把正文 HTML 转成一行纯文本摘要：去掉标签（含 script / style 的内容），解码实体，
// 块级元素之间留一个空格，连续空白合并；最多 maxRunes 个字符，超出时截断并在末尾加「…」。
// 用标准的 HTML 分词器而不是正则，属性值里带 > 的标签也能正确跳过；读够字数就停，不必处理整篇正文。
// 用于文章列表摘要与 meta description；AI 用的纯文本保留标题、列表等结构，另见 service.htmlToPlainText
func HTMLExcerpt(content string, maxRunes int) string {
	if maxRunes <= 0 || content == "" {
		return ""
	}
	z := html.NewTokenizer(strings.NewReader(content))
	runes := make([]rune, 0, maxRunes+1)
	skipDepth := 0        // 位于 script / style / template 等不显示的元素里
	pendingSpace := false // 已有文字之后遇到空白或块级边界，下一个字之前补一个空格
	for len(runes) <= maxRunes {
		tokenType := z.Next()
		switch tokenType {
		case html.ErrorToken:
			// io.EOF 或残缺的 HTML：到此为止，已读到的文字照常返回
			return string(runes)
		case html.TextToken:
			if skipDepth > 0 {
				continue
			}
			for _, r := range string(z.Text()) {
				if unicode.IsSpace(r) {
					pendingSpace = len(runes) > 0
					continue
				}
				if pendingSpace {
					runes = append(runes, ' ')
					pendingSpace = false
				}
				runes = append(runes, r)
				if len(runes) > maxRunes {
					break
				}
			}
		case html.StartTagToken, html.EndTagToken, html.SelfClosingTagToken:
			name, _ := z.TagName()
			tag := atom.Lookup(name)
			if hiddenTextTags[tag] {
				switch tokenType {
				case html.StartTagToken:
					skipDepth++
				case html.EndTagToken:
					if skipDepth > 0 {
						skipDepth--
					}
				}
				continue
			}
			if !inlineTextTags[tag] {
				pendingSpace = pendingSpace || len(runes) > 0
			}
		}
	}
	// 超出上限：截到 maxRunes 个字，去掉末尾空格后加省略号
	return strings.TrimRightFunc(string(runes[:maxRunes]), unicode.IsSpace) + "…"
}

// hiddenTextTags 内容不显示给读者的元素
var hiddenTextTags = map[atom.Atom]bool{
	atom.Script: true, atom.Style: true, atom.Template: true, atom.Noscript: true,
}

// inlineTextTags 行内元素：前后不加空格，「加<strong>粗</strong>」仍是「加粗」；其余元素（段落、列表项、表格单元格、换行等）视为分隔
var inlineTextTags = map[atom.Atom]bool{
	atom.A: true, atom.Abbr: true, atom.B: true, atom.Bdi: true, atom.Bdo: true, atom.Cite: true,
	atom.Code: true, atom.Data: true, atom.Del: true, atom.Dfn: true, atom.Em: true, atom.I: true,
	atom.Ins: true, atom.Kbd: true, atom.Mark: true, atom.Q: true, atom.Rp: true, atom.Rt: true,
	atom.Ruby: true, atom.S: true, atom.Samp: true, atom.Small: true, atom.Span: true, atom.Strong: true,
	atom.Sub: true, atom.Sup: true, atom.Time: true, atom.U: true, atom.Var: true, atom.Font: true,
}
