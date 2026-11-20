/**
 * 歌词字体的自托管网页字体（见 spec 7.2b「字体」）：在艺术字体栈中排在首位（见 lyric-player.css），
 * 确保 Safari（默认屏蔽本机可选中文字体）与 Chrome 及移动端渲染完全一致的字形；省流量模式或 2G 网络下回退到系统字体。
 *
 * 体积控制：每种字体只引入一个字重（宋体单独带 700，其余单字重艺术字体由 CSS 关闭伪粗体合成保持干净笔触）、只用 woff2、按 unicode-range 分片——
 * 只声明 @font-face，浏览器只下载歌词里实际出现的字所在的分片。
 *
 * 这些样式表加起来约 580 KB（每个字体一份几百条 unicode-range 的分片表），只有歌词舞台真正挂载时才注入，
 * 否则全站每个页面都要为它解析一遍（见 docs/perf-log.md）。文件由 scripts/gen-webfonts.mjs 生成到 public/fonts。
 */
export const LYRIC_FONT_STYLESHEETS = [
  '/fonts/noto-serif-sc-bold.css',
  '/fonts/lxgw-wenkai.css',
  '/fonts/zhi-mang-xing.css',
  '/fonts/zcool-xiaowei.css',
  '/fonts/zcool-kuaile.css',
  '/fonts/dancing-script.css',
]

let injected = false

/** 注入歌词字体样式表（幂等）。歌词舞台挂载时调用一次即可，后续命中浏览器缓存 */
export function loadLyricFonts() {
  if (injected || typeof document === 'undefined')
    return
  injected = true
  for (const href of LYRIC_FONT_STYLESHEETS) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.lyricFonts = ''
    document.head.append(link)
  }
}
