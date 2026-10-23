/* eslint-disable next/no-img-element -- satori 只认原生 img，不能换成 next/image */
import type { ReactElement } from 'react'

/*
 * 文章分享图的排版（供 p/[id]/share-image 路由使用）：
 * - 竖版小卡片（4:5），白底 + 深色文字，参考国内社区分享卡：顶部站点信息、中间标题摘要、底部信息栏 + 二维码
 * - 只依赖 satori 支持的样式子集，颜色统一用十六进制或 rgba，不用 oklch / CSS 变量
 * - 字体由调用方注入，这里的元素都要显式写 display: flex
 */

export const SHARE_CARD_SIZE = { width: 1080, height: 1350 }

// 与 web/src/app/styles/*.css 中的 --hue 保持一致，用于给分享图取一点站点主题色
const SCHEME_HUES: Record<string, number> = {
  blue: 250,
  green: 150,
  orange: 50,
  pink: 350,
  red: 25,
  rose: 10,
  violet: 290,
  yellow: 85,
}

const TEXT_COLOR = '#16181d'
const MUTED_COLOR = '#79808c'
const BORDER_COLOR = '#eceef2'
const BACKGROUND = '#ffffff'

// 标题与摘要的字号，同时决定路由里截断的字符数
const TITLE_FONT_SIZE = 62
const DESC_FONT_SIZE = 30

export interface ShareCardData {
  siteName: string
  siteHost: string
  colorScheme?: string
  title: string
  description: string
  labels: string[]
  // 作者与日期等辅助信息，已拼接好
  meta: string
  // 已转成 data URL 的封面与站点图标，抓取失败时为 null
  cover: string | null
  logo: string | null
  // 已转成 data URL 的二维码（指向文章绝对地址），生成失败时为 null
  qr: string | null
  // 二维码下的一句提示，由调用方按语言传入
  scanText: string
}

export function ShareCard({
  siteName,
  siteHost,
  colorScheme,
  title,
  description,
  labels,
  meta,
  cover,
  logo,
  qr,
  scanText,
}: ShareCardData): ReactElement {
  const accent = accentColor(colorScheme)
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: 72,
        backgroundColor: BACKGROUND,
        color: TEXT_COLOR,
        fontFamily: 'Noto Sans SC',
        fontWeight: 500,
      }}
    >
      {/* 顶栏：站点图标 + 站点名 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        {logo
          ? <img src={logo} width={56} height={56} style={{ borderRadius: 14, objectFit: 'cover' }} />
          : <div style={{ display: 'flex', width: 56, height: 56, borderRadius: 14, backgroundColor: accent }} />}
        <div style={{ display: 'flex', fontSize: 30, letterSpacing: 0.5 }}>{siteName}</div>
      </div>

      {labels.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginTop: 56 }}>
          {labels.map(label => (
            <div
              key={label}
              style={{
                display: 'flex',
                padding: '8px 22px',
                borderRadius: 999,
                fontSize: 24,
                color: accent,
                backgroundColor: withAlpha(accent, 0.1),
              }}
            >
              {label}
            </div>
          ))}
        </div>
      )}

      {/* 标题与摘要：竖版空间足够，标题最多四行 */}
      <div
        style={{
          display: 'flex',
          marginTop: labels.length > 0 ? 32 : 56,
          fontSize: TITLE_FONT_SIZE,
          lineHeight: 1.36,
          letterSpacing: -0.5,
        }}
      >
        {title}
      </div>
      {description && (
        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: DESC_FONT_SIZE,
            lineHeight: 1.62,
            color: MUTED_COLOR,
          }}
        >
          {description}
        </div>
      )}

      {/* 封面：占满剩余空间，裁切填充，圆角与卡片其余元素统一 */}
      {cover && (
        <div style={{ display: 'flex', flex: 1, minHeight: 0, marginTop: 44 }}>
          <img src={cover} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 24 }} />
        </div>
      )}
      {!cover && <div style={{ display: 'flex', flex: 1 }} />}

      {/* 底栏：左侧作者/日期与站点地址，右侧二维码 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 44, paddingTop: 36, borderTop: `2px solid ${BORDER_COLOR}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flexGrow: 1, minWidth: 0, paddingRight: 40 }}>
          {meta && <div style={{ display: 'flex', fontSize: 28 }}>{meta}</div>}
          {siteHost && <div style={{ display: 'flex', fontSize: 26, color: MUTED_COLOR }}>{siteHost}</div>}
        </div>
        {qr && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <img src={qr} width={150} height={150} style={{ borderRadius: 6 }} />
            <div style={{ display: 'flex', fontSize: 22, color: MUTED_COLOR }}>{scanText}</div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 主题名 → 强调色：色相取自 app/styles 里的 --hue，固定较高的饱和度和适中的明度，白底上依然清晰 */
function accentColor(scheme?: string) {
  const hue = SCHEME_HUES[scheme ?? ''] ?? SCHEME_HUES.blue
  return hslToHex(hue, 62, 48)
}

function hslToHex(h: number, s: number, l: number) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

// satori 对 8 位十六进制支持不稳定，半透明统一写成 rgba
function withAlpha(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 0xFF
  const g = (value >> 8) & 0xFF
  const b = value & 0xFF
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
