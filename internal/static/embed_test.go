package static

import (
	"testing"
)

func TestRenderTemplate(t *testing.T) {
	template, err := RenderTemplate("email/verification-code.tmpl", map[string]interface{}{
		"Title":   "Test Page",
		"Email":   "xxx@.comcom",
		"Details": "nihao",
	})
	t.Logf(template)
	if err != nil {
		t.Errorf("渲染模板失败: %v", err)
		return
	}
}
