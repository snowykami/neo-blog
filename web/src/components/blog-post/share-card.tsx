import type { ReactElement } from 'react'

/*
 * 文章分享图的排版（供 opengraph-image 路由使用）：
 * - 只依赖 satori 支持的样式子集，颜色统一用十六进制或 rgba，不用 oklch / CSS 变量
 * - 字体由调用方注入，这里的元素都要显式写 display: flex
 */

export const SHARE_CARD_SIZE = { width: 1200, height: 630 }
// 是否带封面会影响文字列的可用宽度，路由按此决定标题与摘要的截断长度
export const SHARE_CARD_COVER_SIZE = 340

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

const TEXT_COLOR = '#f2f5f9'
const MUTED_COLOR = '#8d97a8'
const BACKGROUND = '#0b0e14'
// 标题与摘要的字号，同时决定路由里截断的字符数
const TITLE_FONT_SIZE = 46
const DESC_FONT_SIZE = 26

export interface ShareCardData {
  siteName: string
  siteHost: string
  colorScheme?: string
  title: string
  description: string
  labels: string[]
  // 作者与日期等辅助信息，已拼接好
  meta: string
  // 已转成 data URL 的封面，抓取失败时为 null
  cover: string | null
}

export function ShareCard({ siteName, siteHost, colorScheme, title, description, labels, meta, cover }: ShareCardData): ReactElement {
  const accent = accentColor(colorScheme)
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 64,
        backgroundColor: BACKGROUND,
        backgroundImage: `radial-gradient(circle at 12% 0%, ${withAlpha(accent, 0.28)} 0%, ${withAlpha(accent, 0)} 55%), radial-gradient(circle at 100% 100%, ${withAlpha(accent, 0.16)} 0%, ${withAlpha(accent, 0)} 45%)`,
        color: TEXT_COLOR,
        fontFamily: 'Noto Sans SC',
        fontWeight: 500,
      }}
    >
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 56 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 26 }}>
          {labels.length > 0 && (
            <div style={{ display: 'flex', gap: 12 }}>
              {labels.map(label => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    padding: '6px 18px',
                    borderRadius: 999,
                    fontSize: 24,
                    color: accent,
                    backgroundColor: withAlpha(accent, 0.16),
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', fontSize: TITLE_FONT_SIZE, lineHeight: 1.35, color: TEXT_COLOR }}>{title}</div>
          {description && (
            <div style={{ display: 'flex', fontSize: DESC_FONT_SIZE, lineHeight: 1.5, color: MUTED_COLOR }}>{description}</div>
          )}
        </div>
        {cover && (
          // eslint-disable-next-line next/no-img-element -- satori 只接受 img 元素
          <img
            src={cover}
            alt=""
            width={SHARE_CARD_COVER_SIZE}
            height={SHARE_CARD_COVER_SIZE}
            style={{ width: SHARE_CARD_COVER_SIZE, height: SHARE_CARD_COVER_SIZE, borderRadius: 28, objectFit: 'cover' }}
          />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', width: 10, height: 40, borderRadius: 999, backgroundColor: accent }} />
          <div style={{ display: 'flex', fontSize: 32 }}>{siteName}</div>
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 26, color: MUTED_COLOR }}>
          {meta && <div style={{ display: 'flex' }}>{meta}</div>}
          <div style={{ display: 'flex' }}>{siteHost}</div>
        </div>
      </div>
    </div>
  )
}

/** 站点主题只保存了色相，这里用固定的彩度与亮度换成具体颜色 */
function accentColor(scheme?: string) {
  const hue = SCHEME_HUES[scheme ?? ''] ?? SCHEME_HUES.blue
  const saturation = 0.78
  const lightness = 0.62
  const a = saturation * Math.min(lightness, 1 - lightness)
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255)
  }
  return `#${[channel(0), channel(8), channel(4)].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

/** satori 对 8 位十六进制颜色支持不稳定，统一转成 rgba */
function withAlpha(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
