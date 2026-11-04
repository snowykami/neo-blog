/**
 * 文章内容主题与正文字体注册表
 * - 内容主题只管正文排版（标题、段落、引用、列表、表格、行内代码等），与站点配色、明暗无关；
 *   样式见 app/styles/content-themes，作用于带 content-body 类名与 data-content-theme 属性的正文容器
 * - 正文字体：主题正文与 <span data-font="…"> 局部字体共用同一组字体键，网页字体按需加载
 */

/** 内容主题，与后端 config.ContentThemes 一致；第一项为默认主题 */
export const CONTENT_THEMES = ['default', 'github', 'book', 'academic', 'journal'] as const
export type ContentTheme = (typeof CONTENT_THEMES)[number]

export function isContentTheme(value: unknown): value is ContentTheme {
  return CONTENT_THEMES.includes(value as ContentTheme)
}

/** 文章实际使用的主题：文章未选（或选了不认识的主题）时跟随站点默认 */
export function resolveContentTheme(postTheme?: string | null, siteTheme?: string | null): ContentTheme {
  if (isContentTheme(postTheme))
    return postTheme
  return isContentTheme(siteTheme) ? siteTheme : CONTENT_THEMES[0]
}

/** 自托管网页字体，由 scripts/gen-webfonts.mjs 生成到 public/fonts/<字体>.css（按 unicode-range 分片） */
export type WebFont = 'noto-serif-sc' | 'lxgw-wenkai' | 'zhi-mang-xing' | 'zcool-xiaowei' | 'zcool-kuaile' | 'dancing-script'

export function webFontHref(font: WebFont) {
  return `/fonts/${font}.css`
}

/** 正文字体键（与歌词字体一致，另加黑体）；字体栈见 app/styles/content-themes/_fonts.scss */
export const CONTENT_FONTS = ['sans', 'song', 'kai', 'xingkai', 'fangsong', 'round', 'script', 'mono'] as const
export type ContentFont = (typeof CONTENT_FONTS)[number]

export function isContentFont(value: unknown): value is ContentFont {
  return CONTENT_FONTS.includes(value as ContentFont)
}

/** 字体用到的网页字体：黑体与等宽字体用系统字体（等宽另有全站已加载的 Source Code Pro），不需要额外下载 */
const FONT_WEBFONTS: Record<ContentFont, WebFont[]> = {
  sans: [],
  song: ['noto-serif-sc'],
  kai: ['lxgw-wenkai'],
  // 芝麻行书缺字时回退到霞鹜文楷
  xingkai: ['zhi-mang-xing', 'lxgw-wenkai'],
  fangsong: ['zcool-xiaowei'],
  round: ['zcool-kuaile'],
  script: ['dancing-script'],
  mono: [],
}

/** 主题正文用到的字体（标题等使用系统字体的不在此列） */
const THEME_FONTS: Record<ContentTheme, ContentFont[]> = {
  default: [],
  github: [],
  book: ['song'],
  academic: ['song'],
  journal: ['kai'],
}

/** 局部字体在正文 HTML 中的写法：<span data-font="kai"> */
export const CONTENT_FONT_ATTR = 'data-font'
const FONT_ATTR_PATTERN = /\sdata-font=["']?([a-z]+)/g

/** 正文中局部字体用到的字体键 */
export function usedContentFonts(html: string): ContentFont[] {
  const fonts = new Set<ContentFont>()
  for (const match of html.matchAll(FONT_ATTR_PATTERN)) {
    if (isContentFont(match[1]))
      fonts.add(match[1])
  }
  return [...fonts]
}

/** 按字体键列出需要加载的网页字体（去重、保持顺序） */
export function webFontsOf(fonts: Iterable<ContentFont>): WebFont[] {
  return [...new Set([...fonts].flatMap(font => FONT_WEBFONTS[font]))]
}

/** 正文需要加载的网页字体：主题字体 + 局部字体 */
export function contentWebFonts(theme: ContentTheme, html: string): WebFont[] {
  return webFontsOf([...THEME_FONTS[theme], ...usedContentFonts(html)])
}

/** 编辑器里所有主题与局部字体都可能用到，加载全部网页字体 */
export const ALL_WEBFONTS: WebFont[] = webFontsOf(CONTENT_FONTS)
