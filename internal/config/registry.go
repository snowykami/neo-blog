// Package config 全局配置注册表：每项配置只在 items.go 中声明一次（类型、默认值、取值范围、可覆盖它的环境变量、存储位置，
// 以及后台表单的名称 / 说明文案的 i18n 键），运行时读取（环境变量 > 后台配置 > 默认值）、后台表单的结构下发与保存校验都由声明推导。
// 新增一项普通配置只需在 items.go 加一行声明、在前端语言文件加文案，后台表单会按类型自动生成对应的输入组件
package config

import (
	"encoding/json"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// Type 配置值的类型：决定读取与保存时的校验，以及后台表单使用的输入组件
type Type string

const (
	TypeString     Type = "string"      // 单行文本
	TypeText       Type = "text"        // 多行文本
	TypeSecret     Type = "secret"      // 密钥，后台默认隐藏
	TypeURL        Type = "url"         // 链接
	TypeEmail      Type = "email"       // 邮箱
	TypeImage      Type = "image"       // 图片地址，可从资产库选择
	TypeColor      Type = "color"       // CSS 颜色，留空跟随主题
	TypeInt        Type = "int"         // 整数
	TypeFloat      Type = "float"       // 小数
	TypeBool       Type = "bool"        // 开关
	TypeEnum       Type = "enum"        // 单选，取值见 Options
	TypeStringList Type = "string_list" // 文本列表；有 Options 时为多选
	TypeImageList  Type = "image_list"  // 图片地址列表
	TypeLinkList   Type = "link_list"   // 链接列表 [{text, href}]
	TypeJSON       Type = "json"        // 结构化数据，由 Widget 指定的前端组件编辑
)

// Option 单选 / 多选的可选值
type Option struct {
	Value string `json:"value"`
	Label string `json:"label,omitempty"` // 文案的 i18n 键，为空时直接显示 Value
}

// Condition 另一项配置取 Values 之一时才在后台显示（如歌单来源为网易云时才显示网易云配置）
type Condition struct {
	Key    string   `json:"key"`
	Values []string `json:"values"`
}

// Item 一项配置。文案均为前端 Console.global 命名空间下的 i18n 键
type Item struct {
	Key            string     `json:"key"`
	Type           Type       `json:"type"`
	Label          string     `json:"label"`                     // 名称
	Description    string     `json:"description,omitempty"`     // 说明（提示气泡）
	Placeholder    string     `json:"placeholder,omitempty"`     // 占位文本（原样显示，如示例地址）
	PlaceholderKey string     `json:"placeholder_key,omitempty"` // 需要翻译的占位文本
	Options        []Option   `json:"options,omitempty"`
	Min            *float64   `json:"min,omitempty"`
	Max            *float64   `json:"max,omitempty"`
	Step           float64    `json:"step,omitempty"`   // 数字输入的步长，为 0 时整数为 1、小数不限
	Rows           int        `json:"rows,omitempty"`   // 多行文本的行数
	Wide           bool       `json:"wide,omitempty"`   // 占满整行
	Widget         string     `json:"widget,omitempty"` // 使用前端的专用组件编辑（如侧边栏卡片、网易云歌单）
	ShowWhen       *Condition `json:"show_when,omitempty"`
	Env            string     `json:"env,omitempty"`      // 可覆盖它的环境变量（设置后优先于后台配置，后台只读显示）
	EnvUnit        string     `json:"env_unit,omitempty"` // 环境变量的单位与配置不同时注明，如 seconds
	Default        any        `json:"default"`

	// siteInfoPath 存在 site_info（前台读取的站点信息整体配置）的该路径下；为空时为同名独立配置键
	siteInfoPath []string
	// mirror 同时写入同名独立配置键（后端直接读取这些键），返回要写入的值
	mirror func(value any) any
	// envCustom 环境变量的单位与配置不同（如令牌有效期按秒），由专门的读取函数处理，通用读取不使用环境变量
	envCustom bool
}

// Section 后台表单中的一组配置
type Section struct {
	Tab         string  `json:"tab"`
	Key         string  `json:"key"`
	Title       string  `json:"title"`
	Description string  `json:"description,omitempty"`
	Widget      string  `json:"widget,omitempty"` // 显示在组内最前面、不对应配置项的前端组件（如主题包预览）
	Items       []*Item `json:"items"`
}

// Tab 后台全局配置页的页签
type Tab struct {
	Key   string `json:"key"`
	Title string `json:"title"`
}

const siteInfoKey = "site_info"

var byKey = func() map[string]*Item {
	m := map[string]*Item{}
	for _, section := range sections {
		for _, it := range section.Items {
			if _, dup := m[it.Key]; dup {
				panic("config: duplicate key " + it.Key)
			}
			m[it.Key] = it
		}
	}
	return m
}()

// Lookup 按配置键查找声明，未注册时为 nil
func Lookup(key string) *Item {
	return byKey[key]
}

func mustLookup(key string) *Item {
	it := byKey[key]
	if it == nil {
		panic("config: unknown key " + key)
	}
	return it
}

// ---- 运行时读取：环境变量 > 后台配置 > 默认值，数字按取值范围截断 ----

func String(key string) string    { s, _ := value(mustLookup(key)).(string); return s }
func Int(key string) int          { n, _ := value(mustLookup(key)).(int); return n }
func Float(key string) float64    { n, _ := value(mustLookup(key)).(float64); return n }
func Bool(key string) bool        { b, _ := value(mustLookup(key)).(bool); return b }
func Strings(key string) []string { l, _ := value(mustLookup(key)).([]string); return l }

// Value 实际生效的值（类型同声明），未注册的键为 nil
func Value(key string) any {
	if it := Lookup(key); it != nil {
		return value(it)
	}
	return nil
}

func value(it *Item) any {
	if env, ok := it.EnvValue(); ok && !it.envCustom {
		v, _ := it.parseEnv(env)
		return it.clamp(v)
	}
	return it.clamp(it.dbValue())
}

// EnvValue 环境变量中的取值（去掉首尾空白）；未设置或取值无法按类型解析时 ok 为 false，此时使用后台配置
func (it *Item) EnvValue() (string, bool) {
	if it.Env == "" {
		return "", false
	}
	env := strings.TrimSpace(utils.Env.Get(it.Env))
	if env == "" {
		return "", false
	}
	if _, ok := it.parseEnv(env); !ok {
		return "", false
	}
	return env, true
}

// parseEnv 按类型解析环境变量（开关同 strconv.ParseBool，如 1 / true / 0 / false）。
// 单选不校验取值：写错时原样使用，例如人机验证会拒绝请求，而不是悄悄回退为不启用
func (it *Item) parseEnv(env string) (any, bool) {
	switch it.Type {
	case TypeInt:
		n, err := strconv.Atoi(env)
		return n, err == nil
	case TypeFloat:
		n, err := strconv.ParseFloat(env, 64)
		return n, err == nil
	case TypeBool:
		b, err := strconv.ParseBool(env)
		return b, err == nil
	case TypeStringList, TypeImageList, TypeLinkList, TypeJSON:
		return nil, false
	}
	return env, true
}

// dbValue 后台保存的值，未保存过或类型不符时为默认值
func (it *Item) dbValue() any {
	if raw, ok := it.stored(); ok {
		if v, ok := it.normalize(raw); ok {
			return v
		}
	}
	return it.Default
}

// stored 数据库中的原始值：存在 site_info 中的配置先读 site_info，没有时再读同名独立配置键（兼容旧数据）
func (it *Item) stored() (any, bool) {
	if len(it.siteInfoPath) > 0 {
		if info, ok := repo.KV.GetKVWithoutErr(siteInfoKey, nil).(map[string]any); ok {
			if v, ok := getPath(info, it.siteInfoPath); ok {
				return v, true
			}
		}
	}
	v, err := repo.KV.GetKV(it.Key)
	return v, err == nil
}

// normalize 按类型校验并规整取值（文本去掉首尾空白、列表去掉空项、数字统一为 int / float64），类型不符时 ok 为 false
func (it *Item) normalize(raw any) (any, bool) {
	switch it.Type {
	case TypeInt:
		n, ok := toFloat(raw)
		return int(n), ok
	case TypeFloat:
		return toFloat(raw)
	case TypeBool:
		b, ok := raw.(bool)
		return b, ok
	case TypeEnum:
		s, ok := raw.(string)
		s = strings.TrimSpace(s)
		return s, ok && it.hasOption(s)
	case TypeStringList, TypeImageList:
		list, ok := toStrings(raw)
		if ok && len(it.Options) > 0 {
			// 多选只保留可选值（如已下线的配色）
			list = slices.DeleteFunc(list, func(s string) bool { return !it.hasOption(s) })
		}
		return list, ok
	case TypeLinkList:
		return toLinks(raw)
	case TypeJSON:
		return raw, raw != nil
	}
	s, ok := raw.(string)
	return strings.TrimSpace(s), ok
}

func (it *Item) hasOption(v string) bool {
	return slices.ContainsFunc(it.Options, func(o Option) bool { return o.Value == v })
}

func (it *Item) inRange(v any) bool {
	n, ok := toFloat(v)
	if !ok || (it.Type != TypeInt && it.Type != TypeFloat) {
		return true
	}
	return (it.Min == nil || n >= *it.Min) && (it.Max == nil || n <= *it.Max)
}

func (it *Item) clamp(v any) any {
	switch n := v.(type) {
	case int:
		if it.Min != nil {
			n = max(n, int(*it.Min))
		}
		if it.Max != nil {
			n = min(n, int(*it.Max))
		}
		return n
	case float64:
		if it.Min != nil {
			n = math.Max(n, *it.Min)
		}
		if it.Max != nil {
			n = math.Min(n, *it.Max)
		}
		return n
	}
	return v
}

// ---- 后台表单 ----

// ItemView 下发给后台表单的配置项：声明加上数据库中的值与环境变量的值
type ItemView struct {
	*Item
	Value      any    `json:"value"`
	EnvValue   string `json:"env_value,omitempty"`
	Standalone bool   `json:"standalone"` // 存为同名独立配置键（高级键值编辑可直接修改）；否则只存在 site_info 中
}

type SectionView struct {
	Tab         string     `json:"tab"`
	Key         string     `json:"key"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	Widget      string     `json:"widget,omitempty"`
	Items       []ItemView `json:"items"`
}

type Schema struct {
	Tabs     []Tab         `json:"tabs"`
	Sections []SectionView `json:"sections"`
}

// GetSchema 后台全局配置表单的结构与当前值（仅管理员可读，含密钥）
func GetSchema() Schema {
	views := make([]SectionView, 0, len(sections))
	for _, section := range sections {
		items := make([]ItemView, 0, len(section.Items))
		for _, it := range section.Items {
			env, _ := it.EnvValue()
			items = append(items, ItemView{Item: it, Value: it.dbValue(), EnvValue: env, Standalone: len(it.siteInfoPath) == 0 || it.mirror != nil})
		}
		views = append(views, SectionView{Tab: section.Tab, Key: section.Key, Title: section.Title, Description: section.Description, Widget: section.Widget, Items: items})
	}
	return Schema{Tabs: tabs, Sections: views}
}

// Change 后台修改的一项配置
type Change struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

// Save 校验并保存后台修改的配置：只写入数据库，环境变量设置的配置照常保存但不生效，直到去掉环境变量
func Save(changes []Change) *errs.ServiceError {
	pending := make(map[string]any, len(changes))
	for _, change := range changes {
		it := Lookup(change.Key)
		if it == nil {
			return errs.NewBadRequest("unknown_config_key")
		}
		v, ok := it.normalize(change.Value)
		if !ok || !it.inRange(v) {
			return errs.NewBadRequest("invalid_config_value")
		}
		pending[it.Key] = v
	}
	// 涉及多项配置的校验以保存后实际生效的值为准
	effective := func(key string) any {
		it := mustLookup(key)
		if env, ok := it.EnvValue(); ok && !it.envCustom {
			v, _ := it.parseEnv(env)
			return v
		}
		if v, ok := pending[key]; ok {
			return v
		}
		return it.dbValue()
	}
	for _, check := range crossChecks {
		touched := slices.ContainsFunc(check.keys, func(key string) bool { _, ok := pending[key]; return ok })
		if touched {
			if code := check.check(effective); code != "" {
				return errs.NewBadRequest(code)
			}
		}
	}

	var info map[string]any
	for key, v := range pending {
		it := byKey[key]
		if len(it.siteInfoPath) > 0 {
			if info == nil {
				info = siteInfoForWrite()
			}
			setPath(info, it.siteInfoPath, v)
		} else if err := repo.KV.SetKV(key, v); err != nil {
			return errs.NewInternalServer("internal_server_error")
		}
		if it.mirror != nil {
			if err := repo.KV.SetKV(key, it.mirror(v)); err != nil {
				return errs.NewInternalServer("internal_server_error")
			}
		}
	}
	if info != nil {
		if err := repo.KV.SetKV(siteInfoKey, info); err != nil {
			return errs.NewInternalServer("internal_server_error")
		}
	}
	return nil
}

// siteInfoForWrite 待修改的站点信息副本（不改动缓存中的值）；还没保存过时按各项当前的值补全，避免前台读到缺字段的站点信息
func siteInfoForWrite() map[string]any {
	if info, ok := repo.KV.GetKVWithoutErr(siteInfoKey, nil).(map[string]any); ok {
		var cloned map[string]any
		if raw, err := json.Marshal(info); err == nil && json.Unmarshal(raw, &cloned) == nil {
			return cloned
		}
	}
	info := map[string]any{}
	for _, it := range byKey {
		if v := it.dbValue(); len(it.siteInfoPath) > 0 && v != nil {
			setPath(info, it.siteInfoPath, v)
		}
	}
	return info
}

// ---- 取值转换 ----

func toFloat(raw any) (float64, bool) {
	switch n := raw.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

// toStrings 文本列表：去掉首尾空白与空项；单个字符串视为只有一项（兼容旧数据中单张默认封面）
func toStrings(raw any) ([]string, bool) {
	var items []any
	switch v := raw.(type) {
	case string:
		items = []any{v}
	case []string:
		for _, s := range v {
			items = append(items, s)
		}
	case []any:
		items = v
	default:
		return nil, false
	}
	list := make([]string, 0, len(items))
	for _, item := range items {
		s, ok := item.(string)
		if !ok {
			return nil, false
		}
		if s = strings.TrimSpace(s); s != "" {
			list = append(list, s)
		}
	}
	return list, true
}

// toLinks 链接列表：每项为 {text, href}，两者都为空的项去掉
func toLinks(raw any) ([]map[string]any, bool) {
	var items []any
	switch v := raw.(type) {
	case []any:
		items = v
	case []map[string]any:
		for _, m := range v {
			items = append(items, m)
		}
	default:
		return nil, false
	}
	links := make([]map[string]any, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			return nil, false
		}
		text, _ := m["text"].(string)
		href, _ := m["href"].(string)
		text, href = strings.TrimSpace(text), strings.TrimSpace(href)
		if text != "" || href != "" {
			links = append(links, map[string]any{"text": text, "href": href})
		}
	}
	return links, true
}

func getPath(m map[string]any, path []string) (any, bool) {
	for i, key := range path {
		v, ok := m[key]
		if !ok {
			return nil, false
		}
		if i == len(path)-1 {
			return v, v != nil
		}
		if m, ok = v.(map[string]any); !ok {
			return nil, false
		}
	}
	return nil, false
}

func setPath(m map[string]any, path []string, v any) {
	for _, key := range path[:len(path)-1] {
		next, ok := m[key].(map[string]any)
		if !ok {
			next = map[string]any{}
			m[key] = next
		}
		m = next
	}
	m[path[len(path)-1]] = v
}
