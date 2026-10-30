package mcpserver

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
)

// 组件清单由前端测试根据组件注册表生成（web/src/components/content-components/ai-components.test.ts），
// 只包含对 AI 开放的组件；组件定义变化后在 web 目录运行 pnpm test -u 更新
//
//go:embed ai-components.json
var componentManifestJSON []byte

const componentFencePrefix = "component:"

type componentDef struct {
	Name         string          `json:"name"`
	Version      int             `json:"version"`
	Usage        string          `json:"usage"`
	DefaultWidth int             `json:"default_width"`
	PropsSchema  json.RawMessage `json:"props_schema"`
	schema       *jsonschema.Schema
	resolved     *jsonschema.Resolved
}

type componentRegistry struct {
	Components       []*componentDef `json:"components"`
	FallbackSkipKeys []string        `json:"fallback_skip_keys"` // 取值为选项或标识的字段，生成降级内容时跳过
}

var components = loadComponents()

func loadComponents() *componentRegistry {
	registry := &componentRegistry{}
	if err := json.Unmarshal(componentManifestJSON, registry); err != nil {
		panic(fmt.Sprintf("mcpserver: invalid ai-components.json: %v", err))
	}
	for _, def := range registry.Components {
		def.schema = &jsonschema.Schema{}
		if err := json.Unmarshal(def.PropsSchema, def.schema); err != nil {
			panic(fmt.Sprintf("mcpserver: invalid props schema of %s: %v", def.Name, err))
		}
		// 部分字段的默认值本身不满足校验（如必填正文默认为空），与前端一致：先补默认值再整体校验
		resolved, err := def.schema.Resolve(nil)
		if err != nil {
			panic(fmt.Sprintf("mcpserver: cannot resolve props schema of %s: %v", def.Name, err))
		}
		def.resolved = resolved
	}
	return registry
}

func (r *componentRegistry) get(name string) *componentDef {
	for _, def := range r.Components {
		if def.Name == name {
			return def
		}
	}
	return nil
}

func (r *componentRegistry) names() []string {
	names := make([]string, 0, len(r.Components))
	for _, def := range r.Components {
		names = append(names, def.Name)
	}
	return names
}

// guide 写作指南中的组件列表：与编辑器帮写提示词的格式一致
func (r *componentRegistry) guide() string {
	lines := make([]string, 0, len(r.Components))
	for _, def := range r.Components {
		var schema bytes.Buffer
		_ = json.Compact(&schema, def.PropsSchema)
		lines = append(lines, fmt.Sprintf("- %s：%s\n  props：%s", def.Name, def.Usage, schema.String()))
	}
	return strings.Join(lines, "\n")
}

// normalizeProps 补全默认值、去掉 schema 之外的字段后校验（与前端 zod 的解析结果一致）
func (def *componentDef) normalizeProps(raw string) (map[string]any, error) {
	var props map[string]any
	if err := json.Unmarshal([]byte(raw), &props); err != nil || props == nil {
		return nil, errors.New("props must be a JSON object on a single line")
	}
	normalizeValue(props, def.schema)
	if err := def.resolved.Validate(props); err != nil {
		return nil, err
	}
	return props, nil
}

// normalizeValue 按 schema 递归处理对象与数组：缺少的字段取默认值，未定义的字段删除
// jsonschema 库的 ApplyDefaults 不会进入数组元素，这里自行处理
func normalizeValue(value any, schema *jsonschema.Schema) {
	if schema == nil {
		return
	}
	switch v := value.(type) {
	case map[string]any:
		if schema.Properties == nil {
			return
		}
		for key := range v {
			if _, ok := schema.Properties[key]; !ok {
				delete(v, key)
			}
		}
		for key, prop := range schema.Properties {
			if _, ok := v[key]; !ok && prop.Default != nil {
				var def any
				if json.Unmarshal(prop.Default, &def) == nil {
					v[key] = def
				}
			}
			normalizeValue(v[key], prop)
		}
	case []any:
		for _, item := range v {
			normalizeValue(item, schema.Items)
		}
	}
}

// fallbackHTML 组件块的降级内容：props 中的正文文字按段落输出，供 RSS、无 JS 环境展示；编辑器保存时会重新生成
func fallbackHTML(props map[string]any) string {
	var texts []string
	var collect func(value any)
	collect = func(value any) {
		switch v := value.(type) {
		case string:
			for _, part := range reParagraphBreak.Split(v, -1) {
				if part = strings.TrimSpace(part); part != "" {
					texts = append(texts, part)
				}
			}
		case []any:
			for _, item := range v {
				collect(item)
			}
		case map[string]any:
			keys := make([]string, 0, len(v))
			for key := range v {
				if !slices.Contains(components.FallbackSkipKeys, key) {
					keys = append(keys, key)
				}
			}
			slices.Sort(keys)
			for _, key := range keys {
				collect(v[key])
			}
		}
	}
	collect(props)
	var sb strings.Builder
	for _, text := range texts {
		sb.WriteString("<p>" + html.EscapeString(text) + "</p>")
	}
	return sb.String()
}

var reParagraphBreak = regexp.MustCompile(`\n\s*\n`)

// goldmark 把 ```component:名称 渲染为带语言类名的代码块，内容已做 HTML 转义
var reComponentFence = regexp.MustCompile(`<pre><code class="language-` + regexp.QuoteMeta(componentFencePrefix) + `([^"]*)">([\s\S]*?)</code></pre>`)

// convertComponentFences 把 Markdown 中的组件代码块转换为组件块；任一组件不合法时返回错误，整次写入作废
func convertComponentFences(content string) (string, error) {
	var errs []string
	index := 0
	result := reComponentFence.ReplaceAllStringFunc(content, func(match string) string {
		index++
		sub := reComponentFence.FindStringSubmatch(match)
		name := html.UnescapeString(sub[1])
		def := components.get(name)
		if def == nil {
			errs = append(errs, fmt.Sprintf("component block #%d: unknown component %q (available: %s)", index, name, strings.Join(components.names(), ", ")))
			return match
		}
		props, err := def.normalizeProps(strings.TrimSpace(html.UnescapeString(sub[2])))
		if err != nil {
			errs = append(errs, fmt.Sprintf("component block #%d (%s): %v", index, name, err))
			return match
		}
		// 与前端 serializePropsAttr 一致：json.Marshal 默认把 < > & 转义为 < 等
		propsJSON, _ := json.Marshal(props)
		var sb strings.Builder
		sb.WriteString(`<div data-component="` + html.EscapeString(def.Name) + `" data-props="` + html.EscapeString(string(propsJSON)) + `" data-version="` + strconv.Itoa(def.Version) + `"`)
		if def.DefaultWidth != 0 && def.DefaultWidth != 100 {
			sb.WriteString(` data-width="` + strconv.Itoa(def.DefaultWidth) + `"`)
		}
		sb.WriteString(">" + fallbackHTML(props) + "</div>")
		return sb.String()
	})
	if len(errs) > 0 {
		return "", errors.New(strings.Join(errs, "; "))
	}
	return result, nil
}

// componentFence 把组件块渲染为 Markdown 中的组件代码块；只处理对 AI 开放、版本一致、没有自定义布局且 props 合法的组件，
// 其余返回 false，由调用方原样保留 HTML，避免丢失信息
func componentFence(name, version, propsAttr string, attrs map[string]string) (string, bool) {
	def := components.get(name)
	if def == nil || version != strconv.Itoa(def.Version) {
		return "", false
	}
	if attrs["data-align"] != "" || attrs["data-height"] != "" {
		return "", false
	}
	if width := attrs["data-width"]; width != "" && width != strconv.Itoa(def.DefaultWidth) {
		return "", false
	}
	// 现存 props 不满足当前 schema 时保留 HTML，否则 AI 原样写回也会被拒绝
	if _, err := def.normalizeProps(propsAttr); err != nil {
		return "", false
	}
	var props bytes.Buffer
	if err := json.Compact(&props, []byte(propsAttr)); err != nil {
		return "", false
	}
	return "```" + componentFencePrefix + def.Name + "\n" + props.String() + "\n```", true
}
