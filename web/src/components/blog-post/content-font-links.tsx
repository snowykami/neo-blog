import type { WebFont } from '@/lib/content-theme'
import { webFontHref } from '@/lib/content-theme'

/**
 * 正文用到的网页字体样式表（只含 @font-face，见 scripts/gen-webfonts.mjs）。
 * React 会把带 precedence 的样式表提升到 head 并按地址去重，服务端与客户端组件中都可以使用
 */
export function ContentFontLinks({ fonts }: { fonts: WebFont[] }) {
  return fonts.map(font => <link key={font} rel="stylesheet" href={webFontHref(font)} precedence="content-fonts" />)
}
