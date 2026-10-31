'use client'

import type { LucideIcon } from 'lucide-react'
import type { SVGProps } from 'react'
import type { ThemeIconName } from './types'
import {
  BalloonIcon,
  BellIcon,
  CloudRainIcon,
  Flower2Icon,
  GiftIcon,
  GraduationCapIcon,
  HeartIcon,
  LeafIcon,
  MoonIcon,
  SnowflakeIcon,
  SparklesIcon,
  StarIcon,
  TerminalIcon,
} from 'lucide-react'

/**
 * 主题图标表：lucide 没有的节日专属图形在这里手绘（保持与 lucide 一致的 24 线性描边风格），
 * 其余直接复用 lucide。主题只引用字符串 id，保证主题数据可 JSON 序列化。
 */

type ThemeIconComponent = (props: SVGProps<SVGSVGElement>) => React.ReactElement

/** 与 lucide 一致的默认描边参数 */
function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  )
}

/** 灯笼：春节 / 元宵 */
function LanternGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6.5 10.5a5.5 4.5 0 0 1 11 0 5.5 4.5 0 0 1-11 0Z" />
      <path d="M9 6.2v8.6M15 6.2v8.6" />
      <path d="M9.5 15.2h5" />
      <path d="M12 15.2V19" />
      <path d="M12 2.2v2.6" />
    </Svg>
  )
}

/** 月饼：中秋 */
function MooncakeGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="4.6" />
      <path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2" />
    </Svg>
  )
}

/** 粽子：端午 */
function ZongziGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3.6 19.8 17.4a1.2 1.2 0 0 1-1 1.8H5.2a1.2 1.2 0 0 1-1-1.8L12 3.6Z" />
      <path d="M7.4 11.4h9.2" />
      <path d="M6.2 16.4 18 9.6" />
    </Svg>
  )
}

/** 南瓜灯：万圣节 */
function PumpkinGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 5.4c3.6 0 6.6 3 6.6 6.6s-3 6.6-6.6 6.6-6.6-3-6.6-6.6 3-6.6 6.6-6.6Z" />
      <path d="M12 5.4v13.2M8.4 6.8c-1.1 2.9-1.1 7.5 0 10.4M15.6 6.8c1.1 2.9 1.1 7.5 0 10.4" />
      <path d="M12 5.4V3.6a1.2 1.2 0 0 1 1.2-1.2" />
    </Svg>
  )
}

/** 樱花：樱花季 */
function SakuraGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="1.5" />
      <ellipse cx="12" cy="7" rx="2.3" ry="3.1" />
      <ellipse cx="12" cy="7" rx="2.3" ry="3.1" transform="rotate(72 12 12)" />
      <ellipse cx="12" cy="7" rx="2.3" ry="3.1" transform="rotate(144 12 12)" />
      <ellipse cx="12" cy="7" rx="2.3" ry="3.1" transform="rotate(216 12 12)" />
      <ellipse cx="12" cy="7" rx="2.3" ry="3.1" transform="rotate(288 12 12)" />
    </Svg>
  )
}

/** 双星：七夕 */
function TwinStarsGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8.2 3.4l1.3 3.4 3.4 1.3-3.4 1.3-1.3 3.4-1.3-3.4L3.5 8.1l3.4-1.3Z" />
      <path d="M16.4 12.2l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9Z" />
    </Svg>
  )
}

/** 菊花：重阳 */
function ChrysanthemumGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 9.8V5.6M12 14.2v4.2M9.8 12H5.6M14.2 12h4.2" />
      <path d="M10.4 10.4 7.8 7.8M13.6 13.6l2.6 2.6M13.6 10.4l2.6-2.6M10.4 13.6l-2.6 2.6" />
    </Svg>
  )
}

/** 蝙蝠：万圣节 */
function BatGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 8.6c1.5 0 2.5.9 2.5 2.2 0 1.1-.9 1.6-2.5 1.6s-2.5-.5-2.5-1.6c0-1.3 1-2.2 2.5-2.2Z" />
      <path d="M9.6 10.4C7.8 8.8 5.7 8.2 3.2 8.6c.6 1.6.6 3.3 0 4.9 1.2-.4 2 .2 2.6 1.2.5 1 1.4 1.2 2.3.7l1.5-1.1" />
      <path d="M14.4 10.4c1.8-1.6 3.9-2.2 6.4-1.8-.6 1.6-.6 3.3 0 4.9-1.2-.4-2 .2-2.6 1.2-.5 1-1.4 1.2-2.3.7l-1.5-1.1" />
      <path d="M10.3 8.5 9.5 5.7l2 1.3M13.7 8.5l.8-2.8-2 1.3" />
    </Svg>
  )
}

/** 幽灵：万圣节 */
function GhostGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M5.8 18.4V11a6.2 6.2 0 0 1 12.4 0v7.4l-2.1-1.5-2 1.5-2.1-1.5-2 1.5-2.1-1.5-2.1 1.5Z" />
      <path d="M10 11h.01M14 11h.01" />
      <path d="M11 14h2" />
    </Svg>
  )
}

/** 糖果：万圣节 */
function CandyGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="7" y="9" width="10" height="6" rx="3" />
      <path d="M7 12 3.2 9.4v5.2L7 12ZM17 12l3.8-2.6v5.2L17 12Z" />
      <path d="M10.4 9.2v5.6M13.6 9.2v5.6" />
    </Svg>
  )
}

/** 圣诞树 */
function TreeGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3.2 16 9.6h-8L12 3.2Z" />
      <path d="M12 7.8l5.2 7.6H6.8L12 7.8Z" />
      <path d="M12 15.4v4.4M8.8 19.8h6.4" />
    </Svg>
  )
}

/** 兔子：中秋 */
function RabbitGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M9.7 10.2C8.5 7.4 8.7 4.4 9.9 4.2c1.2-.2 2 2.3 2.1 6.1" />
      <path d="M14.3 10.2c1.2-2.8 1-5.8-.2-6-1.2-.2-2 2.3-2.1 6.1" />
      <circle cx="12" cy="15.2" r="4.6" />
      <path d="M10.8 14.4h.01M13.2 14.4h.01" />
      <path d="M11.2 16.6h1.6" />
    </Svg>
  )
}

/** 烟花：跨年 / 国庆 */
function FireworkGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="1.4" />
      <path d="M12 3v3.6M12 17.4V21M3 12h3.6M17.4 12H21" />
      <path d="M6 6l2.4 2.4M15.6 15.6 18 18M18 6l-2.4 2.4M8.4 15.6 6 18" />
    </Svg>
  )
}

/** 梅花：春节 */
function PlumBlossomGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.2" r="2" />
      <circle cx="15.6" cy="10.8" r="2" />
      <circle cx="14.2" cy="15" r="2" />
      <circle cx="9.8" cy="15" r="2" />
      <circle cx="8.4" cy="10.8" r="2" />
      <circle cx="12" cy="12" r="1.2" />
    </Svg>
  )
}

/** 饺子：春节 / 冬至 */
function DumplingGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3.8 15.2c0-4.1 3.7-7.2 8.2-7.2s8.2 3.1 8.2 7.2c0 1.2-1 2-2.2 2H6c-1.2 0-2.2-.8-2.2-2Z" />
      <path d="M8 9.6c.8 1.5 1.2 3 1.2 4.6M12 8v6M16 9.6c-.8 1.5-1.2 3-1.2 4.6" />
    </Svg>
  )
}

/** 喜鹊：七夕 */
function MagpieGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 17.6c2.6-5.6 5-8.7 8.6-9.5 2-.5 3.3.6 3.3 2.1 0 1-.6 1.7-1.6 2" />
      <path d="M14.4 10.4 19 8.3l-.7 3.2" />
      <path d="M9.9 13.1 7 17.6l4.2-1.2" />
    </Svg>
  )
}

export const THEME_ICONS: Record<ThemeIconName, ThemeIconComponent | LucideIcon> = {
  'lantern': LanternGlyph,
  'mooncake': MooncakeGlyph,
  'zongzi': ZongziGlyph,
  'pumpkin': PumpkinGlyph,
  'sakura': SakuraGlyph,
  'twin-stars': TwinStarsGlyph,
  'chrysanthemum': ChrysanthemumGlyph,
  'snowflake': SnowflakeIcon,
  'sparkles': SparklesIcon,
  'star': StarIcon,
  'terminal': TerminalIcon,
  'balloon': BalloonIcon,
  'gift': GiftIcon,
  'heart': HeartIcon,
  'graduation-cap': GraduationCapIcon,
  'flower': Flower2Icon,
  'cloud-rain': CloudRainIcon,
  'bat': BatGlyph,
  'ghost': GhostGlyph,
  'candy': CandyGlyph,
  'tree': TreeGlyph,
  'bell': BellIcon,
  'rabbit': RabbitGlyph,
  'firework': FireworkGlyph,
  'plum-blossom': PlumBlossomGlyph,
  'dumpling': DumplingGlyph,
  'magpie': MagpieGlyph,
  'moon': MoonIcon,
  'leaf': LeafIcon,
}

/** 按名字取图标组件，名字非法时返回 undefined 由调用方回落 */
export function getThemeIcon(name?: ThemeIconName): (ThemeIconComponent | LucideIcon) | undefined {
  return name ? THEME_ICONS[name] : undefined
}
