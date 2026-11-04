package config

import (
	"slices"
	"strings"
)

// ContentThemes 文章内容主题（只管正文排版，与站点配色、明暗无关），对应前端 styles/content-themes 下的主题文件；
// 第一项为站点默认值的默认值
var ContentThemes = []string{"default", "github", "book", "academic", "journal"}

// NormalizeContentTheme 文章选用的主题：空字符串表示跟随站点默认，不认识的主题同样按跟随处理
func NormalizeContentTheme(theme string) string {
	theme = strings.TrimSpace(theme)
	if slices.Contains(ContentThemes, theme) {
		return theme
	}
	return ""
}
