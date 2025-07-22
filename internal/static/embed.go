package static

import (
	"bytes"
	"embed"
	"fmt"
	"html/template"
)

//go:embed assets/*
var AssetsFS embed.FS

// RenderTemplate 从嵌入的文件系统中读取模板并渲染
func RenderTemplate(name string, data interface{}) (string, error) {
	templatePath := "assets/" + name
	templateContent, err := AssetsFS.ReadFile(templatePath)
	if err != nil {
		return "", fmt.Errorf("读取模板文件失败: %w", err)
	}
	// 解析模板
	tmpl, err := template.New(name).Parse(string(templateContent))
	if err != nil {
		return "", fmt.Errorf("解析模板失败: %w", err)
	}
	// 渲染模板
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("渲染模板失败: %w", err)
	}
	return buf.String(), nil
}
