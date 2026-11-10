/**
 * 歌词字体的自托管网页字体（见 spec 7.2b「字体」）：只在系统没有对应字体时作为回退（字体栈见 lyric-player.css），
 * 手机（iOS / Android 不带宋体、楷体等中文字体）与没有下载可选字体的电脑上才会用到。
 *
 * 体积控制：每种字体只引入一个字重（歌词按 700 排版，所以宋体单独带 700）、只用 woff2、按 unicode-range 分片——
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
