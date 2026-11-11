package utils

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestHTMLExcerpt(t *testing.T) {
	cases := []struct {
		name    string
		content string
		max     int
		want    string
	}{
		{"plain", "<p>你好，世界</p>", 200, "你好，世界"},
		{"inline tags keep words together", "<p>加<strong>粗</strong>与<em>斜体</em></p>", 200, "加粗与斜体"},
		{"blocks separated by a space", "<h2>标题</h2><p>第一段</p><ul><li>一</li><li>二</li></ul>", 200, "标题 第一段 一 二"},
		{"entities decoded", "<p>a &amp; b &lt;T&gt; &nbsp;c</p>", 200, "a & b <T> c"},
		{"script and style dropped", "<style>.x{}</style><p>正文</p><script>alert(1)</script>", 200, "正文"},
		// 属性值里带 > 与很长的属性（如 data-hdr）：正则去标签会截在这里，分词器能完整跳过
		{"attributes with angle brackets", `<p><span data-hdr="a>b" data-props='{"k":"<v>"}'>测试音频</span></p>`, 200, "测试音频"},
		{"truncated with ellipsis", "<p>一二三四五六</p>", 4, "一二三四…"},
		{"no ellipsis at exact length", "<p>一二三四</p>", 4, "一二三四"},
		{"trailing space trimmed before ellipsis", "<p>ab</p><p>cd</p>", 3, "ab…"},
		{"broken html returns what was read", "<p>完整<span data-x=\"未闭合", 200, "完整"},
		{"empty", "", 200, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := HTMLExcerpt(c.content, c.max); got != c.want {
				t.Fatalf("HTMLExcerpt(%q, %d) = %q, want %q", c.content, c.max, got, c.want)
			}
		})
	}
}

// 很长的正文只读到够用为止，结果长度不超过上限加省略号
func TestHTMLExcerptLongContent(t *testing.T) {
	content := strings.Repeat("<p>段落内容</p>", 10000)
	got := HTMLExcerpt(content, 200)
	if n := utf8.RuneCountInString(got); n > 201 || n < 190 || !strings.HasSuffix(got, "…") {
		t.Fatalf("excerpt runes = %d (%q)", n, got)
	}
}
