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

var fallbackFormattingTags = map[string]struct{}{
	"a": {}, "b": {}, "blockquote": {}, "br": {}, "code": {}, "del": {}, "div": {}, "em": {},
	"h1": {}, "h2": {}, "h3": {}, "h4": {}, "h5": {}, "h6": {}, "hr": {}, "i": {}, "input": {},
	"kbd": {}, "li": {}, "mark": {}, "ol": {}, "p": {}, "pre": {}, "s": {}, "span": {},
	"strong": {}, "sub": {}, "sup": {}, "table": {}, "tbody": {}, "td": {}, "th": {},
	"thead": {}, "tr": {}, "u": {}, "ul": {},
}

func isASCIIAlphaNum(b byte) bool {
	return (b >= '0' && b <= '9') || (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z')
}

// stripFormattingTags 线性剥离平台行内 HTML 排版标签（兼容属性值内含 >，保留普通 a < b 表达式）
func stripFormattingTags(input string) string {
	var sb strings.Builder
	i := 0
	for i < len(input) {
		if input[i] != '<' {
			sb.WriteByte(input[i])
			i++
			continue
		}
		cursor := i + 1
		isClosing := false
		if cursor < len(input) && input[cursor] == '/' {
			isClosing = true
			cursor++
		}
		nameStart := cursor
		for cursor < len(input) && isASCIIAlphaNum(input[cursor]) {
			cursor++
		}
		tagName := strings.ToLower(input[nameStart:cursor])
		validBoundary := cursor < len(input) && (input[cursor] == '>' || input[cursor] == '/' || input[cursor] == ' ' || input[cursor] == '\t' || input[cursor] == '\n' || input[cursor] == '\r')
		if _, ok := fallbackFormattingTags[tagName]; !ok || !validBoundary {
			sb.WriteByte(input[i])
			i++
			continue
		}
		var quote byte
		end := -1
		for j := cursor; j < len(input); j++ {
			ch := input[j]
			if quote != 0 {
				if ch == quote {
					quote = 0
				}
			} else if ch == '"' || ch == '\'' {
				quote = ch
			} else if ch == '>' {
				end = j
				break
			}
		}
		if end == -1 {
			sb.WriteByte(input[i])
			i++
			continue
		}
		if tagName == "br" && !isClosing {
			sb.WriteByte('\n')
		}
		i = end + 1
	}
	return sb.String()
}

func stripMarkdownBlockPrefix(rawLine string) string {
	line := strings.TrimLeft(rawLine, " \t")
	for strings.HasPrefix(line, ">") {
		line = strings.TrimLeft(line[1:], " \t")
	}
	hashes := 0
	for hashes < 6 && hashes < len(line) && line[hashes] == '#' {
		hashes++
	}
	if hashes > 0 && hashes < len(line) && (line[hashes] == ' ' || line[hashes] == '\t') {
		return strings.TrimLeft(line[hashes+1:], " \t")
	}
	if len(line) >= 2 && (line[0] == '-' || line[0] == '*' || line[0] == '+') && (line[1] == ' ' || line[1] == '\t') {
		rest := strings.TrimLeft(line[2:], " \t")
		if len(rest) >= 4 && rest[0] == '[' && (rest[1] == ' ' || rest[1] == 'x' || rest[1] == 'X') && rest[2] == ']' && (rest[3] == ' ' || rest[3] == '\t') {
			rest = strings.TrimLeft(rest[4:], " \t")
		}
		return rest
	}
	digits := 0
	for digits < len(line) && line[digits] >= '0' && line[digits] <= '9' {
		digits++
	}
	if digits > 0 && digits+1 < len(line) && line[digits] == '.' && (line[digits+1] == ' ' || line[digits+1] == '\t') {
		return strings.TrimLeft(line[digits+2:], " \t")
	}
	return line
}

var (
	reFallbackLink   = regexp.MustCompile(`\[([^\]\n]+)\]\([^)\n]+\)`)
	reFallbackStrong = regexp.MustCompile(`\*\*([^*\n]+)\*\*`)
	reFallbackEm     = regexp.MustCompile(`\*([^*\s][^*\n]*?)\*`)
	reFallbackStrike = regexp.MustCompile(`~~([^~\n]+)~~`)
	reCodeSlot       = regexp.MustCompile("\uE000(\\d+)\uE001")
)

func renderFallbackProse(chunk string, sb *strings.Builder) {
	var codeSlots []string
	var masked strings.Builder
	for i := 0; i < len(chunk); {
		if chunk[i] == '`' {
			closeIdx := strings.IndexByte(chunk[i+1:], '`')
			if closeIdx > 0 {
				inner := chunk[i+1 : i+1+closeIdx]
				if strings.IndexByte(inner, '\n') < 0 {
					idx := len(codeSlots)
					codeSlots = append(codeSlots, inner)
					masked.WriteString("\uE000" + strconv.Itoa(idx) + "\uE001")
					i += closeIdx + 2
					continue
				}
			}
		}
		masked.WriteByte(chunk[i])
		i++
	}

	withoutTags := stripFormattingTags(masked.String())
	for _, rawLine := range strings.Split(withoutTags, "\n") {
		line := stripMarkdownBlockPrefix(rawLine)
		line = reFallbackLink.ReplaceAllString(line, "$1")
		line = reFallbackStrong.ReplaceAllString(line, "$1")
		line = reFallbackEm.ReplaceAllString(line, "$1")
		line = reFallbackStrike.ReplaceAllString(line, "$1")
		line = reCodeSlot.ReplaceAllStringFunc(line, func(m string) string {
			sub := reCodeSlot.FindStringSubmatch(m)
			if len(sub) == 2 {
				if idx, err := strconv.Atoi(sub[1]); err == nil && idx >= 0 && idx < len(codeSlots) {
					return codeSlots[idx]
				}
			}
			return m
		})
		if line = strings.TrimSpace(line); line != "" {
			sb.WriteString("<p>" + html.EscapeString(line) + "</p>")
		}
	}
}

func renderFallbackRichText(text string, sb *strings.Builder) {
	lines := strings.Split(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"), "\n")
	var proseBuf, codeBuf []string
	inFence := false
	flushProse := func() {
		if len(proseBuf) == 0 {
			return
		}
		renderFallbackProse(strings.Join(proseBuf, "\n"), sb)
		proseBuf = nil
	}
	for _, line := range lines {
		if strings.HasPrefix(strings.TrimLeft(line, " \t"), "```") {
			if !inFence {
				flushProse()
				inFence = true
				codeBuf = nil
			} else {
				if code := strings.TrimSpace(strings.Join(codeBuf, "\n")); code != "" {
					sb.WriteString("<pre><code>" + html.EscapeString(code) + "</code></pre>")
				}
				inFence = false
				codeBuf = nil
			}
			continue
		}
		if inFence {
			codeBuf = append(codeBuf, line)
		} else {
			proseBuf = append(proseBuf, line)
		}
	}
	if inFence && len(codeBuf) > 0 {
		if code := strings.TrimSpace(strings.Join(codeBuf, "\n")); code != "" {
			sb.WriteString("<pre><code>" + html.EscapeString(code) + "</code></pre>")
		}
	}
	flushProse()
}

func fallbackKeyPriority(key string) int {
	switch key {
	case "title":
		return 0
	case "label":
		return 1
	case "description":
		return 2
	default:
		return 10
	}
}

// fallbackHTML 组件块的降级内容：供 RSS、无 JS 环境展示；对富文本字段剥离标签与 Markdown 噪音，对代码字段原样保留
func fallbackHTML(props map[string]any) string {
	var sb strings.Builder
	var collect func(key string, value any)
	collect = func(key string, value any) {
		switch v := value.(type) {
		case string:
			if key == "code" {
				if code := strings.Trim(v, "\r\n"); strings.TrimSpace(code) != "" {
					sb.WriteString("<pre><code>" + html.EscapeString(code) + "</code></pre>")
				}
				return
			}
			renderFallbackRichText(v, &sb)
		case []any:
			for _, item := range v {
				collect(key, item)
			}
		case map[string]any:
			keys := make([]string, 0, len(v))
			for k := range v {
				if !slices.Contains(components.FallbackSkipKeys, k) {
					keys = append(keys, k)
				}
			}
			slices.SortFunc(keys, func(a, b string) int {
				if pa, pb := fallbackKeyPriority(a), fallbackKeyPriority(b); pa != pb {
					return pa - pb
				}
				return strings.Compare(a, b)
			})
			for _, k := range keys {
				collect(k, v[k])
			}
		}
	}
	collect("", props)
	return sb.String()
}

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
