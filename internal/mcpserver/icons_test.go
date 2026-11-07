package mcpserver

import (
	"strings"
	"testing"
)

// 行内图标在 Markdown 中原样写成空标签，往返后不变，前后的空格不被吞掉
func TestIconRoundTrip(t *testing.T) {
	stored := `<p>前 <span data-icon="star"></span> 后，紧贴<span data-icon="rocket"></span>文字</p>` +
		`<p><strong>加粗 <span data-icon="zap"></span></strong> 尾，<span style="color: var(--color-green-500)"><span data-icon="leaf"></span> 绿色</span></p>` +
		`<h2><span data-icon="book-open"></span> 标题</h2><ul><li><p><span data-icon="check"></span> 一项</p></li></ul>`
	md, err := renderContent(stored, formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`前 <span data-icon="star"></span> 后，紧贴<span data-icon="rocket"></span>文字`,
		`**加粗 <span data-icon="zap"></span>** 尾`,
		`<span style="color: var(--color-green-500)"><span data-icon="leaf"></span> 绿色</span>`,
		`## <span data-icon="book-open"></span> 标题`,
		`- <span data-icon="check"></span> 一项`,
	} {
		if !strings.Contains(md, want) {
			t.Errorf("markdown missing %q:\n%s", want, md)
		}
	}
	if strings.Contains(md, iconPlaceholderAttr) {
		t.Errorf("placeholder attribute leaked:\n%s", md)
	}
	back, err := parseContent(md, formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`<p>前 <span data-icon="star"></span> 后，紧贴<span data-icon="rocket"></span>文字</p>`,
		`<strong>加粗 <span data-icon="zap"></span></strong> 尾`,
		`<span style="color: var(--color-green-500)"><span data-icon="leaf"></span> 绿色</span>`,
		`<h2><span data-icon="book-open"></span> 标题</h2>`,
		`<li><span data-icon="check"></span> 一项</li>`,
	} {
		if !strings.Contains(back, want) {
			t.Errorf("lost %q\nmarkdown:\n%s\nhtml:\n%s", want, md, back)
		}
	}
}

func TestIconWrite(t *testing.T) {
	// 自闭合写法补成成对的空标签，不会把后面的文字包进去
	got, err := parseContent(`前 <span data-icon="star"/> 后，<span data-icon="heart" /> 再`, formatMarkdown)
	if err != nil {
		t.Fatal(err)
	}
	if want := `<p>前 <span data-icon="star"></span> 后，<span data-icon="heart"></span> 再</p>`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
	// 别名（lucide 改名前的名字）也可以用
	if _, err := parseContent(`<span data-icon="alarm-check"></span>`, formatMarkdown); err != nil {
		t.Errorf("alias rejected: %v", err)
	}
	// 代码中的示例不当作图标
	if _, err := parseContent("`<span data-icon=\"nope\"></span>`\n\n```html\n<span data-icon=\"nope\">x</span>\n```", formatMarkdown); err != nil {
		t.Errorf("code sample rejected: %v", err)
	}
	for input, want := range map[string]string{
		`<span data-icon="no-such-icon"></span> 和 <span data-icon="Star"></span>`: `unknown icon name "no-such-icon", "Star"`,
		`<span data-icon="star">⭐</span>`: "must be empty",
	} {
		if _, err := parseContent(input, formatMarkdown); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("parseContent(%q) error = %v, want %q", input, err, want)
		}
	}
	// HTML 格式原样写入，不做校验
	if _, err := parseContent(`<p><span data-icon="no-such-icon"></span></p>`, formatHTML); err != nil {
		t.Errorf("html format validated: %v", err)
	}
}

func TestIconPatch(t *testing.T) {
	stored := `<p><span data-icon="rocket"></span> 第一段</p><p>第二段 <span data-icon="star"></span> 结尾</p>`
	result, region, err := applyMarkdownPatch(stored, `第二段 <span data-icon="star"></span> 结尾`, `第二段 <span data-icon="heart"></span> 改过`)
	if err != nil {
		t.Fatal(err)
	}
	if want := `<p><span data-icon="rocket"></span> 第一段</p><p>第二段 <span data-icon="heart"></span> 改过</p>`; result != want {
		t.Errorf("got %s, want %s (region %q)", result, want, region)
	}
}
