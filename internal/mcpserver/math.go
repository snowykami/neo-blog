package mcpserver

import (
	"bytes"
	"html"
	"strings"

	"github.com/JohannesKaufmann/dom"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
	xhtml "golang.org/x/net/html"
)

// 数学公式（LaTeX）：编辑器存为 <span data-type="inline-math" data-latex="…"></span> 与
// <div data-type="block-math" data-latex="…"></div>（前台用 KaTeX 渲染）；Markdown 中写作行内 $…$、单独成段的 $$…$$，
// 规则与前端 web/src/lib/math/latex.ts 一致
const (
	inlineMathType = "inline-math"
	blockMathType  = "block-math"
)

func isSpaceByte(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}

// matchInlineMath 从 line 开头的 $ 匹配一个行内公式（只在同一行内），返回公式内容与消耗的字节数
// - $$…$$：内容不含 $、不为空白
// - $…$：开头的 $ 后面、结尾的 $ 前面不能是空白，结尾的 $ 后面不能紧跟数字或 $，所以「$5 和 $10」不是公式
// - 反斜杠转义的 \$ 不作为分隔符
func matchInlineMath(line []byte) (string, int, bool) {
	if len(line) == 0 || line[0] != '$' {
		return "", 0, false
	}
	double := len(line) > 1 && line[1] == '$'
	start := 1
	if double {
		start = 2
	}
	if !double && (start >= len(line) || isSpaceByte(line[start])) {
		return "", 0, false
	}
	for i := start; i < len(line); i++ {
		switch line[i] {
		case '\\':
			i++
			continue
		case '\n':
			return "", 0, false
		case '$':
		default:
			continue
		}
		latex := string(line[start:i])
		if double {
			if i+1 >= len(line) || line[i+1] != '$' || strings.TrimSpace(latex) == "" {
				return "", 0, false
			}
			return strings.TrimSpace(latex), i + 2, true
		}
		if isSpaceByte(line[i-1]) || (i+1 < len(line) && (line[i+1] == '$' || (line[i+1] >= '0' && line[i+1] <= '9'))) {
			return "", 0, false
		}
		return latex, i + 1, true
	}
	return "", 0, false
}

var (
	kindInlineMath = ast.NewNodeKind("InlineMath")
	kindBlockMath  = ast.NewNodeKind("BlockMath")
)

type inlineMathNode struct {
	ast.BaseInline
	latex string
}

func (n *inlineMathNode) Kind() ast.NodeKind { return kindInlineMath }

func (n *inlineMathNode) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Latex": n.latex}, nil)
}

type blockMathNode struct {
	ast.BaseBlock
	latex string
	// 公式块在源码中的结束位置（闭合 $$ 所在行的行尾）
	end int
}

func (n *blockMathNode) Kind() ast.NodeKind { return kindBlockMath }

func (n *blockMathNode) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Latex": n.latex}, nil)
}

type inlineMathParser struct{}

func (p *inlineMathParser) Trigger() []byte { return []byte{'$'} }

func (p *inlineMathParser) Parse(_ ast.Node, block text.Reader, _ parser.Context) ast.Node {
	line, _ := block.PeekLine()
	latex, length, ok := matchInlineMath(line)
	if !ok {
		return nil
	}
	block.Advance(length)
	return &inlineMathNode{latex: latex}
}

// blockMathParser 单独成段的 $$ … $$（可跨行）；先在源码中找到闭合的 $$，找不到时不当作公式块，避免吞掉后文
type blockMathParser struct{}

func (p *blockMathParser) Trigger() []byte { return []byte{'$'} }

func (p *blockMathParser) Open(_ ast.Node, reader text.Reader, pc parser.Context) (ast.Node, parser.State) {
	line, segment := reader.PeekLine()
	pos := pc.BlockOffset()
	if pos < 0 || !bytes.HasPrefix(line[pos:], []byte("$$")) {
		return nil, parser.NoChildren
	}
	contentStart := segment.Start + pos + 2
	rest := reader.Source()[contentStart:]
	end := bytes.Index(rest, []byte("$$"))
	if end < 0 {
		return nil, parser.NoChildren
	}
	tail := rest[end+2:]
	if nl := bytes.IndexByte(tail, '\n'); nl >= 0 {
		tail = tail[:nl]
	}
	latex := strings.TrimSpace(string(rest[:end]))
	if latex == "" || len(bytes.TrimSpace(tail)) > 0 {
		return nil, parser.NoChildren
	}
	node := &blockMathNode{latex: latex, end: contentStart + end + 2 + len(tail)}
	reader.AdvanceToEOL()
	if segment.Stop >= node.end {
		return node, parser.Close
	}
	return node, parser.NoChildren
}

func (p *blockMathParser) Continue(node ast.Node, reader text.Reader, _ parser.Context) parser.State {
	_, segment := reader.PeekLine()
	reader.AdvanceToEOL()
	if segment.Stop >= node.(*blockMathNode).end {
		return parser.Close
	}
	return parser.Continue | parser.NoChildren
}

func (p *blockMathParser) Close(ast.Node, text.Reader, parser.Context) {}

func (p *blockMathParser) CanInterruptParagraph() bool { return true }

func (p *blockMathParser) CanAcceptIndentedLine() bool { return false }

type mathRenderer struct{}

func (r *mathRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindInlineMath, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString(`<span data-type="` + inlineMathType + `" data-latex="` + html.EscapeString(n.(*inlineMathNode).latex) + `"></span>`)
		}
		return ast.WalkSkipChildren, nil
	})
	reg.Register(kindBlockMath, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString(`<div data-type="` + blockMathType + `" data-latex="` + html.EscapeString(n.(*blockMathNode).latex) + `"></div>` + "\n")
		}
		return ast.WalkSkipChildren, nil
	})
}

// mathExtension goldmark 扩展：解析 $…$ / $$…$$ 并输出编辑器的公式节点
type mathExtension struct{}

func (e *mathExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(
		parser.WithBlockParsers(util.Prioritized(&blockMathParser{}, 650)),
		parser.WithInlineParsers(util.Prioritized(&inlineMathParser{}, 500)),
	)
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(&mathRenderer{}, 500)))
}

// isMathElement 是否为编辑器的公式节点
func isMathElement(n *xhtml.Node) bool {
	if n.Type != xhtml.ElementNode {
		return false
	}
	nodeType, _ := dom.GetAttribute(n, "data-type")
	_, ok := dom.GetAttribute(n, "data-latex")
	return ok && (nodeType == inlineMathType || nodeType == blockMathType)
}

// mathMarkdown 公式节点转为 Markdown；行内公式内容不适合写成 $…$ 时（含 $、首尾空白、后面紧跟数字）改用 $$…$$
func mathMarkdown(nodeType, latex string, nextChar byte) (string, bool) {
	switch nodeType {
	case inlineMathType:
		latex = strings.Join(strings.Fields(latex), " ")
		if latex == "" {
			return "", true
		}
		if strings.Contains(latex, "$") || (nextChar >= '0' && nextChar <= '9') {
			return "$$" + latex + "$$", true
		}
		return "$" + latex + "$", true
	case blockMathType:
		latex = strings.TrimSpace(latex)
		if latex == "" {
			return "", true
		}
		return "\n\n$$\n" + latex + "\n$$\n\n", true
	}
	return "", false
}
