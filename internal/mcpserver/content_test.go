package mcpserver

import (
	"strings"
	"testing"
)

// 图片 / 视频块的注释、宽度与对齐在 Markdown 中没有对应语法：整块保留为 HTML，来回转换不丢
func TestHTMLToMarkdownKeepsMediaBlocks(t *testing.T) {
	figure := `<figure class="image-figure" data-align="center" data-width="wide"><img src="/api/v1/file/f/1" alt="图 1"/><figcaption>图 1　说明</figcaption></figure>`
	src := `<h2>图</h2>` + figure + `<p>普通 <img src="/b.png" alt="b"> 图片</p><p><img src="/c.png" alt="c" data-width="wide"></p>`

	md, err := htmlToMarkdown(src)
	if err != nil {
		t.Fatal(err)
	}
	// 带注释的图片与带布局属性的图片保留为 HTML 块
	if !strings.Contains(md, figure) || !strings.Contains(md, `<img src="/c.png" alt="c" data-width="wide"/>`) {
		t.Fatalf("markdown 丢失媒体块：%q", md)
	}
	// 普通图片仍是 Markdown 图片语法
	if !strings.Contains(md, "普通 ![b](/b.png) 图片") {
		t.Fatalf("普通图片应输出 Markdown 图片语法：%q", md)
	}
	if strings.Contains(md, "![图 1](/api/v1/file/f/1)") {
		t.Fatalf("带注释的图片不应退化为普通图片语法：%q", md)
	}

	// 写回 HTML 时图片块原样保留（属性顺序可能变化，按关键片段校验）
	back, err := markdownToHTML(md)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`<figcaption>图 1　说明</figcaption>`,
		`data-width="wide"`,
		`data-align="center"`,
		`<img src="/c.png" alt="c" data-width="wide"/>`,
	} {
		if !strings.Contains(back, want) {
			t.Fatalf("写回后缺少 %q：%q", want, back)
		}
	}
}

// 无注释、无布局属性的图片不进入 HTML 块（保持 Markdown 可读性）
func TestHTMLToMarkdownPlainImage(t *testing.T) {
	md, err := htmlToMarkdown(`<p>前 <img src="/a.png" alt="甲"> 后</p>`)
	if err != nil {
		t.Fatal(err)
	}
	if md != "前 ![甲](/a.png) 后" {
		t.Fatalf("markdown = %q", md)
	}
}
