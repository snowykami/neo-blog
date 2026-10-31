import type { SVGProps } from 'react'
import type { ThemeDecorGlyph } from './types'

/**
 * 主题装饰图元（实心卡通风格）。
 *
 * 与 icons.tsx 的分工：
 * - icons.tsx 是线性图标（24 格、1.6 描边），跟 lucide 保持一致，只用于按钮、计数等 UI 位置；
 * - 这里是为「正文两侧留白」画的大尺寸实心插画，矢量绘制，任意倍率都清晰，
 *   不依赖网络图片，因此不需要额外带宽、不会因为图片挂了变成破图。
 *
 * 配色故意写死为节日色（南瓜橙、松树绿、灯笼红…）：主题本身已经把页面主色改成节日色相，
 * 装饰用同一套节日色会更像「一套东西」，也不必随明暗模式计算对比度。
 * 外层的投影与透明度由调用方（blog-post/theme-gutter）统一加，图元自己不管布局。
 */

type GlyphProps = SVGProps<SVGSVGElement>

function Art({ children, ...props }: GlyphProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" {...props}>
      {children}
    </svg>
  )
}

/** 五瓣小花，梅花 / 樱花 / 雏菊共用 */
function Blossom({ cx, cy, r, fill, core }: { cx: number, cy: number, r: number, fill: string, core: string }) {
  return (
    <g>
      {[0, 72, 144, 216, 288].map(angle => (
        <circle
          key={angle}
          cx={cx + Math.cos((angle * Math.PI) / 180) * r * 0.9}
          cy={cy + Math.sin((angle * Math.PI) / 180) * r * 0.9}
          r={r * 0.72}
          fill={fill}
        />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.42} fill={core} />
    </g>
  )
}

/** 南瓜灯 */
function PumpkinArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M32 20c-1.4-5 0-9 3.6-10.4" stroke="#166534" strokeWidth="5" strokeLinecap="round" fill="none" />
      <ellipse cx="32" cy="38" rx="21" ry="17" fill="#f97316" />
      <ellipse cx="32" cy="38" rx="21" ry="17" fill="#fb923c" opacity=".35" />
      <path d="M32 21c-6.5 4-10 10-10 17s3.5 13 10 17" fill="none" stroke="#ea580c" strokeWidth="2" />
      <path d="M32 21c6.5 4 10 10 10 17s-3.5 13-10 17" fill="none" stroke="#ea580c" strokeWidth="2" />
      <path d="M23.5 32h6.5l-3.2 5.4z" fill="#7c2d12" />
      <path d="M34 32h6.5l-3.2 5.4z" fill="#7c2d12" />
      <path d="M22 43.5c2.2 3 4.2 0 5.4 2.2 1.2 2.2 3.2 0 4.6 2.2 1.4-2.2 3.4 0 4.6-2.2 1.2-2.2 3.2.8 5.4-2.2" fill="none" stroke="#7c2d12" strokeWidth="2.4" strokeLinecap="round" />
    </Art>
  )
}

/** 蝙蝠 */
function BatArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M26.5 27c-4-4.5-9.5-6.5-15.5-5.5 1.8 4.2 1.8 8.6 0 12.8 3.2-1.2 5.4.5 7 3 1.5 2.4 3.8 2.8 6.3 1.5l2.6-1.8z" fill="#5b21b6" />
      <path d="M37.5 27c4-4.5 9.5-6.5 15.5-5.5-1.8 4.2-1.8 8.6 0 12.8-3.2-1.2-5.4.5-7 3-1.5 2.4-3.8 2.8-6.3 1.5l-2.6-1.8z" fill="#5b21b6" />
      <path d="M32 22.5c4.2 0 6.8 2.5 6.8 5.8 0 2.9-2.5 4.4-6.8 4.4s-6.8-1.5-6.8-4.4c0-3.3 2.6-5.8 6.8-5.8Z" fill="#4c1d95" />
      <path d="M27.5 23.5 25 16.5l5.2 3.6z" fill="#4c1d95" />
      <path d="M36.5 23.5 39 16.5l-5.2 3.6z" fill="#4c1d95" />
      <circle cx="29.4" cy="28.4" r="1.5" fill="#fde68a" />
      <circle cx="34.6" cy="28.4" r="1.5" fill="#fde68a" />
      <path d="M30.4 32h1.4l-.7 2.2z" fill="#f8fafc" />
      <path d="M32.4 32H34l-.7 2.2z" fill="#f8fafc" />
    </Art>
  )
}

/** 幽灵 */
function GhostArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M32 10c8.3 0 13.5 6.2 13.5 14.4V50l-4.5-3.8-4.5 3.8-4.5-3.8-4.5 3.8-4.5-3.8L18 50V24.4C18 16.2 23.7 10 32 10Z" fill="#f8fafc" />
      <path d="M32 10c8.3 0 13.5 6.2 13.5 14.4V50l-4.5-3.8-4.5 3.8-4.5-3.8-4.5 3.8-4.5-3.8L18 50V24.4C18 16.2 23.7 10 32 10Z" fill="#e2e8f0" opacity=".45" />
      <circle cx="26.6" cy="27" r="2.8" fill="#334155" />
      <circle cx="37.4" cy="27" r="2.8" fill="#334155" />
      <ellipse cx="32" cy="36" rx="2.6" ry="3.6" fill="#334155" />
      <circle cx="21.6" cy="33" r="3.2" fill="#fda4af" opacity=".65" />
      <circle cx="42.4" cy="33" r="3.2" fill="#fda4af" opacity=".65" />
    </Art>
  )
}

/** 蛛网（左上角） */
function SpiderWebArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <g stroke="#a1a1aa" strokeWidth="1.8" fill="none" strokeLinecap="round">
        <path d="M0 0 58 0M0 0 0 58M0 0 41 41" />
        <path d="M16 0A16 16 0 0 0 0 16" />
        <path d="M29 0A29 29 0 0 0 0 29" />
        <path d="M43 0A43 43 0 0 0 0 43" />
      </g>
      <circle cx="14" cy="14" r="2.6" fill="#52525b" />
    </Art>
  )
}

/** 玉米糖 */
function CandyCornArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M32 8 45.5 30h-27z" fill="#fde047" />
      <path d="M18.5 30h27L51 41H13z" fill="#fb923c" />
      <path d="M13 41h38l2.4 7.6A5 5 0 0 1 48.6 55H15.4A5 5 0 0 1 10.6 48.6z" fill="#f8fafc" />
      <path d="M13 41h38l2.4 7.6A5 5 0 0 1 48.6 55H15.4A5 5 0 0 1 10.6 48.6z" fill="#e2e8f0" opacity=".5" />
    </Art>
  )
}

/** 红灯笼 */
function LanternArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M32 4v5" stroke="#fbbf24" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="25" y="9" width="14" height="5" rx="2" fill="#fbbf24" />
      <ellipse cx="32" cy="32" rx="17" ry="16" fill="#dc2626" />
      <ellipse cx="26" cy="27" rx="5" ry="9" fill="#ef4444" opacity=".55" />
      <path d="M32 16c-5.4 4-8 9.6-8 16s2.6 12 8 16M32 16c5.4 4 8 9.6 8 16s-2.6 12-8 16" fill="none" stroke="#b91c1c" strokeWidth="2" />
      <rect x="25" y="47" width="14" height="5" rx="2" fill="#fbbf24" />
      <path d="M32 52v7" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" />
      <path d="M28 60h8" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" />
    </Art>
  )
}

/** 鞭炮 */
function FirecrackerArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M32 22v-8c0-3.4 3.4-4.6 5.6-2.4" stroke="#a16207" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M37.6 9.6l1.6 3.8 3.8 1.6-3.8 1.6-1.6 3.8-1.6-3.8-3.8-1.6 3.8-1.6z" fill="#fbbf24" />
      <rect x="23" y="22" width="18" height="32" rx="4" fill="#dc2626" />
      <rect x="23" y="29" width="18" height="4.5" fill="#fbbf24" />
      <rect x="23" y="43" width="18" height="4.5" fill="#fbbf24" />
      <rect x="27.5" y="24" width="3" height="26" rx="1.5" fill="#f87171" opacity=".7" />
    </Art>
  )
}

/** 梅枝 */
function PlumArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M6 58C20 46 26 34 30 18" stroke="#78350f" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <path d="M30 20c4-5 9-8 16-8" stroke="#78350f" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <path d="M24 36c-4-3-8-4-13-3" stroke="#78350f" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <Blossom cx={29} cy={17} r={7.4} fill="#fbcfe8" core="#f472b6" />
      <Blossom cx={45} cy={13} r={6.2} fill="#fbcfe8" core="#f472b6" />
      <Blossom cx={12} cy={33} r={5.4} fill="#fbcfe8" core="#f472b6" />
      <Blossom cx={40} cy={30} r={4.6} fill="#fbcfe8" core="#f472b6" />
    </Art>
  )
}

/** 圣诞树 */
function TreeArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <rect x="28" y="46" width="8" height="12" rx="2.5" fill="#78350f" />
      <path d="M32 26 52 52H12z" fill="#15803d" />
      <path d="M32 18 48 41H16z" fill="#16a34a" />
      <path d="M32 10 45 30H19z" fill="#22c55e" />
      <path d="M32 2.4l2 4.4 4.6.6-3.4 3.2.9 4.6-4.1-2.3-4.1 2.3.9-4.6-3.4-3.2 4.6-.6z" fill="#fbbf24" />
      <circle cx="26" cy="36" r="2.4" fill="#ef4444" />
      <circle cx="38" cy="33" r="2.4" fill="#fbbf24" />
      <circle cx="32" cy="44" r="2.4" fill="#3b82f6" />
      <circle cx="22" cy="45" r="2" fill="#f472b6" />
      <circle cx="43" cy="45" r="2" fill="#fbbf24" />
    </Art>
  )
}

/** 雪人 */
function SnowmanArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M19 38 10 31M45 38l9-7" stroke="#78350f" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="32" cy="43" r="13.5" fill="#f1f5f9" />
      <circle cx="32" cy="24" r="10" fill="#f8fafc" />
      <rect x="26" y="7" width="12" height="10" rx="2" fill="#334155" />
      <path d="M21.5 17.5h21v3.4h-21z" fill="#334155" />
      <circle cx="28.4" cy="22.6" r="1.5" fill="#0f172a" />
      <circle cx="35.6" cy="22.6" r="1.5" fill="#0f172a" />
      <path d="M32 26.6l6.4 2.2-6.4 1.8z" fill="#f97316" />
      <path d="M23 33h18l-2.6 4.6H25.6z" fill="#dc2626" />
      <path d="M38 37.6l3 7-4-1z" fill="#dc2626" />
      <circle cx="32" cy="43" r="1.6" fill="#0f172a" />
      <circle cx="32" cy="48.6" r="1.6" fill="#0f172a" />
    </Art>
  )
}

/** 礼物盒 */
function GiftArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <rect x="12" y="26" width="40" height="30" rx="3.5" fill="#dc2626" />
      <rect x="8" y="17" width="48" height="10" rx="2.5" fill="#ef4444" />
      <rect x="28.5" y="17" width="7" height="39" fill="#fbbf24" />
      <path d="M32 17c-6.5-11-15.5-8.5-15.5-2S24.5 19.5 32 17Z" fill="#fbbf24" />
      <path d="M32 17c6.5-11 15.5-8.5 15.5-2S39.5 19.5 32 17Z" fill="#fbbf24" />
      <circle cx="32" cy="17" r="3.4" fill="#f59e0b" />
    </Art>
  )
}

/** 满月 */
function MoonArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <circle cx="32" cy="32" r="30" fill="#fde68a" opacity=".22" />
      <circle cx="32" cy="32" r="22" fill="#fde68a" opacity=".35" />
      <circle cx="32" cy="32" r="17" fill="#fde68a" />
      <circle cx="26" cy="27" r="3.6" fill="#fcd34d" />
      <circle cx="38" cy="34" r="4.6" fill="#fcd34d" />
      <circle cx="30" cy="40" r="2.6" fill="#fcd34d" />
      <circle cx="39" cy="24" r="2.2" fill="#fcd34d" />
    </Art>
  )
}

/** 玉兔 */
function RabbitArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <ellipse cx="24" cy="18" rx="4.4" ry="12" fill="#f8fafc" />
      <ellipse cx="40" cy="18" rx="4.4" ry="12" fill="#f8fafc" />
      <ellipse cx="24" cy="18" rx="2" ry="8" fill="#fda4af" />
      <ellipse cx="40" cy="18" rx="2" ry="8" fill="#fda4af" />
      <ellipse cx="32" cy="52" rx="10" ry="8" fill="#f1f5f9" />
      <circle cx="32" cy="34" r="11.5" fill="#f8fafc" />
      <circle cx="27.6" cy="32" r="1.7" fill="#334155" />
      <circle cx="36.4" cy="32" r="1.7" fill="#334155" />
      <path d="M32 36.6l2.4 2.2L32 40.4l-2.4-1.6z" fill="#fb7185" />
      <circle cx="23.4" cy="37" r="2.6" fill="#fda4af" opacity=".7" />
      <circle cx="40.6" cy="37" r="2.6" fill="#fda4af" opacity=".7" />
    </Art>
  )
}

/** 月饼 */
function MooncakeArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <circle cx="32" cy="34" r="21" fill="#d97706" />
      <circle cx="32" cy="34" r="21" fill="none" stroke="#b45309" strokeWidth="2.6" />
      <circle cx="32" cy="34" r="15" fill="none" stroke="#fbbf24" strokeWidth="1.8" />
      <rect x="26" y="28" width="12" height="12" rx="2" transform="rotate(45 32 34)" fill="none" stroke="#fbbf24" strokeWidth="1.8" />
      <circle cx="32" cy="34" r="3" fill="#fbbf24" />
      <path d="M32 10v3M14 34h3M47 34h3" stroke="#b45309" strokeWidth="2" strokeLinecap="round" />
    </Art>
  )
}

/** 烟花 */
function FireworkArt(props: GlyphProps) {
  const spokes = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 * Math.PI) / 180
    const inner = 6
    const outer = i % 2 === 0 ? 26 : 18
    return {
      angle,
      x1: 32 + Math.cos(angle) * inner,
      y1: 32 + Math.sin(angle) * inner,
      x2: 32 + Math.cos(angle) * outer,
      y2: 32 + Math.sin(angle) * outer,
      dot: i % 3 === 0,
    }
  })
  return (
    <Art {...props}>
      <g stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round">
        {spokes.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ))}
      </g>
      {spokes.map((s, i) => s.dot && <circle key={i} cx={s.x2} cy={s.y2} r="2.8" fill="#f472b6" />)}
      <circle cx="32" cy="32" r="4" fill="#fde68a" />
    </Art>
  )
}

/** 樱花枝 */
function SakuraBranchArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M4 58C18 48 24 36 28 20" stroke="#92400e" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M28 22c5-4 10-6 17-5" stroke="#92400e" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      <Blossom cx={27} cy={18} r={8} fill="#fbcfe8" core="#f472b6" />
      <Blossom cx={44} cy={16} r={6.4} fill="#fce7f3" core="#f472b6" />
      <Blossom cx={38} cy={34} r={5.4} fill="#fbcfe8" core="#f472b6" />
      <circle cx="14" cy="42" r="3" fill="#fce7f3" />
      <circle cx="50" cy="40" r="2.4" fill="#fbcfe8" />
    </Art>
  )
}

/** 心 */
function HeartArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M32 55S9 41.5 9 26.5C9 19 14.6 13.5 22 13.5c4.4 0 8 2 10 5.4 2-3.4 5.6-5.4 10-5.4 7.4 0 13 5.5 13 13C55 41.5 32 55 32 55Z" fill="#f43f5e" />
      <ellipse cx="23" cy="25" rx="4.4" ry="2.8" fill="#fda4af" opacity=".8" transform="rotate(-30 23 25)" />
    </Art>
  )
}

/** 雏菊 / 菊花 */
function DaisyArt(props: GlyphProps) {
  return (
    <Art {...props}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => (
        <ellipse
          key={angle}
          cx="32"
          cy="18"
          rx="5"
          ry="11"
          fill="#fef3c7"
          transform={`rotate(${angle} 32 32)`}
        />
      ))}
      <circle cx="32" cy="32" r="7.5" fill="#f59e0b" />
      <circle cx="32" cy="32" r="7.5" fill="none" stroke="#d97706" strokeWidth="1.6" />
    </Art>
  )
}

/** 学士帽 */
function CapArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M32 12 58 24 32 36 6 24z" fill="#334155" />
      <path d="M17 30v9c0 5 6.8 8 15 8s15-3 15-8v-9" fill="#475569" />
      <path d="M53 27v12" stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="53" cy="42" r="3.4" fill="#fbbf24" />
      <path d="M32 12 58 24" stroke="#1e293b" strokeWidth="1.6" />
    </Art>
  )
}

/** 粽子 */
function ZongziArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M32 8 54 46a4 4 0 0 1-3.5 6H13.5A4 4 0 0 1 10 46z" fill="#15803d" />
      <path d="M32 8 54 46a4 4 0 0 1-3.5 6H13.5A4 4 0 0 1 10 46z" fill="#22c55e" opacity=".25" />
      <path d="M22 30h20M16 42h32M32 8v44" stroke="#a3e635" strokeWidth="1.8" opacity=".75" />
    </Art>
  )
}

/** 图元名 → 组件 */
/** 气球（儿童节） */
function BalloonArt(props: GlyphProps) {
  return (
    <Art {...props}>
      <path d="M22 34c-1.6 5-4.6 8-7 12M41 27c1.4 5.4 4.4 8.6 6.6 12.6M33 44c-.8 4.6-2 7.4-3.4 10.6" stroke="#a1a1aa" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="22" cy="21" r="13" fill="#f43f5e" />
      <ellipse cx="17.6" cy="16" rx="4" ry="2.6" fill="#fda4af" opacity=".85" transform="rotate(-32 17.6 16)" />
      <path d="M18.6 34h6.8l-3.4 3.6z" fill="#be123c" />
      <circle cx="41" cy="16" r="10" fill="#fbbf24" />
      <ellipse cx="37.6" cy="12.4" rx="3.2" ry="2" fill="#fde68a" opacity=".9" transform="rotate(-32 37.6 12.4)" />
      <path d="M38 26h6l-3 3.2z" fill="#d97706" />
      <circle cx="33" cy="38" r="9" fill="#38bdf8" />
      <ellipse cx="30" cy="34.6" rx="2.8" ry="1.8" fill="#bae6fd" opacity=".9" transform="rotate(-32 30 34.6)" />
      <path d="M30.4 47h5.2l-2.6 3z" fill="#0284c7" />
    </Art>
  )
}

export const THEME_DECOR: Record<ThemeDecorGlyph, (props: GlyphProps) => React.ReactElement> = {
  'pumpkin': PumpkinArt,
  'bat': BatArt,
  'ghost': GhostArt,
  'spider-web': SpiderWebArt,
  'candy-corn': CandyCornArt,
  'lantern': LanternArt,
  'firecracker': FirecrackerArt,
  'plum': PlumArt,
  'tree': TreeArt,
  'snowman': SnowmanArt,
  'gift': GiftArt,
  'moon': MoonArt,
  'rabbit': RabbitArt,
  'mooncake': MooncakeArt,
  'firework': FireworkArt,
  'sakura-branch': SakuraBranchArt,
  'heart': HeartArt,
  'daisy': DaisyArt,
  'cap': CapArt,
  'zongzi': ZongziArt,
  'balloon': BalloonArt,
}

export function getThemeDecor(glyph: ThemeDecorGlyph) {
  return THEME_DECOR[glyph]
}
