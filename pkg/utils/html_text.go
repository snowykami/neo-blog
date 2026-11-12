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

// maxNoiseTokenLen 不含空白与汉字的连续 ASCII 串超过该长度时视为 Base64 / 长签名串噪音，不写入全文索引
const maxNoiseTokenLen = 120

// HTMLSearchText 从正文 HTML 提取用于全文检索的纯文本：
//   - 剥离全部 HTML 标签，跳过 script / style / template / noscript
//   - 保留代码块内容，并提取公式节点的 data-latex 与图片的 alt 说明
//   - 剔除超长无空白 ASCII 噪音串（如 Base64、长签名 URL），最多保留 maxRunes 个字符
func HTMLSearchText(content string, maxRunes int) string {
	if maxRunes <= 0 || content == "" {
		return ""
	}
	z := html.NewTokenizer(strings.NewReader(content))
	var raw strings.Builder
	runeCount := 0
	skipDepth := 0
	pendingSpace := false

	appendText := func(s string) {
		for _, r := range s {
			if unicode.IsSpace(r) {
				pendingSpace = raw.Len() > 0
				continue
			}
			if pendingSpace {
				raw.WriteByte(' ')
				runeCount++
				pendingSpace = false
			}
			raw.WriteRune(r)
			runeCount++
			if runeCount >= maxRunes {
				break
			}
		}
	}

	for runeCount < maxRunes {
		tokenType := z.Next()
		if tokenType == html.ErrorToken {
			break
		}
		switch tokenType {
		case html.TextToken:
			if skipDepth > 0 {
				continue
			}
			appendText(string(z.Text()))
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			tag := atom.Lookup(name)
			if hiddenTextTags[tag] {
				if tokenType == html.StartTagToken {
					skipDepth++
				}
				continue
			}
			if !inlineTextTags[tag] {
				pendingSpace = pendingSpace || raw.Len() > 0
			}
			if hasAttr && skipDepth == 0 {
				for {
					k, v, more := z.TagAttr()
					key := string(k)
					if key == "data-latex" || (tag == atom.Img && key == "alt") {
						if val := strings.TrimSpace(string(v)); val != "" {
							pendingSpace = pendingSpace || raw.Len() > 0
							appendText(val)
							pendingSpace = true
						}
					}
					if !more || runeCount >= maxRunes {
						break
					}
				}
			}
		case html.EndTagToken:
			name, _ := z.TagName()
			tag := atom.Lookup(name)
			if hiddenTextTags[tag] {
				if skipDepth > 0 {
					skipDepth--
				}
				continue
			}
			if !inlineTextTags[tag] {
				pendingSpace = pendingSpace || raw.Len() > 0
			}
		}
	}

	// 过滤超长无意义 ASCII 噪音词（如内联 Base64 或签名串）
	words := strings.Fields(raw.String())
	kept := words[:0]
	for _, w := range words {
		if !isNoiseToken(w) {
			kept = append(kept, w)
		}
	}
	return strings.Join(kept, " ")
}

func isNoiseToken(word string) bool {
	if len(word) <= maxNoiseTokenLen {
		return false
	}
	for _, r := range word {
		if unicode.Is(unicode.Han, r) || (r >= 0x3040 && r <= 0x30FF) || (r >= 0xAC00 && r <= 0xD7AF) {
			return false
		}
	}
	return true
}
