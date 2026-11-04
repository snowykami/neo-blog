package mcpserver

import (
	"strings"
	"testing"
)

func TestMarkdownMath(t *testing.T) {
	cases := []struct {
		name    string
		source  string
		want    []string
		notWant []string
	}{
		{
			name:   "inline",
			source: "质能方程 $E = mc^2$ 与 $$a<b$$。",
			want:   []string{`<span data-type="inline-math" data-latex="E = mc^2"></span>`, `<span data-type="inline-math" data-latex="a&lt;b"></span>`},
		},
		{
			name:    "currency is not math",
			source:  "票价 $5 和 $10，另付 $3.",
			want:    []string{"票价 $5 和 $10，另付 $3."},
			notWant: []string{"data-latex"},
		},
		{
			name:    "closing dollar followed by digit",
			source:  "从 $x$5 开始",
			notWant: []string{"data-latex"},
		},
		{
			name:    "escaped dollar",
			source:  `价格 \$x$ 不是公式`,
			want:    []string{"价格 $x$ 不是公式"},
			notWant: []string{"data-latex"},
		},
		{
			name:   "multi-line block",
			source: "前文\n\n$$\n\\frac{a}{b}\n= c\n$$\n\n后文",
			want:   []string{`<div data-type="block-math" data-latex="\frac{a}{b}` + "\n" + `= c"></div>`, "<p>前文</p>", "<p>后文</p>"},
		},
		{
			name:   "single-line block",
			source: "$$x^2 + y^2$$\n\n后文",
			want:   []string{`<div data-type="block-math" data-latex="x^2 + y^2"></div>`, "<p>后文</p>"},
		},
		{
			name:    "unclosed block keeps the rest",
			source:  "$$\nx\n\n后文",
			want:    []string{"后文"},
			notWant: []string{"block-math"},
		},
		{
			name:    "code is not math",
			source:  "`$x$`\n\n```\n$$y$$\n```",
			notWant: []string{"data-latex"},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := markdownToHTML(c.source)
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range c.want {
				if !strings.Contains(got, want) {
					t.Errorf("missing %q in:\n%s", want, got)
				}
			}
			for _, notWant := range c.notWant {
				if strings.Contains(got, notWant) {
					t.Errorf("unexpected %q in:\n%s", notWant, got)
				}
			}
		})
	}
}

func TestMathRoundTrip(t *testing.T) {
	// 编辑器保存的格式：data-latex 在前；文字中的 $ 需转义，写回时不变成公式
	stored := `<p>勾股定理 <span data-latex="a^2+b^2=c^2" data-type="inline-math"></span> 成立，第 <span data-latex="n" data-type="inline-math"></span>1 项，票价 $5 和 $x$</p>` +
		`<div data-latex="\sum_{i=1}^n i = \frac{n(n+1)}{2}" data-type="block-math"></div><p>后文</p>`
	md, err := renderContent(stored, formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"勾股定理 $a^2+b^2=c^2$ 成立", "$$n$$1", `票价 \$5 和 \$x\$`, "$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$"} {
		if !strings.Contains(md, want) {
			t.Errorf("markdown missing %q:\n%s", want, md)
		}
	}
	back, err := parseContent(md, formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`勾股定理 <span data-type="inline-math" data-latex="a^2+b^2=c^2"></span> 成立`,
		`<span data-type="inline-math" data-latex="n"></span>1 项`,
		"票价 $5 和 $x$",
		`<div data-type="block-math" data-latex="\sum_{i=1}^n i = \frac{n(n+1)}{2}"></div>`,
		"<p>后文</p>",
	} {
		if !strings.Contains(back, want) {
			t.Errorf("lost %q\nmarkdown:\n%s\nhtml:\n%s", want, md, back)
		}
	}
}
