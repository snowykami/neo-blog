'use client'

import type { ThemeDecorItem } from '@/themes/types'
import { usePageBackground } from '@/contexts/page-background-context'
import { useTheme } from '@/contexts/theme-context'
import { cn } from '@/lib/utils'
import { getThemeDecor } from '@/themes/decor'

/**
 * 全站背景层（渲染在 (main)/layout 里，控制台不渲染）。
 *
 * 为什么这一层可以用 `position: fixed`：它和版面容器是兄弟节点，祖先没有任何 transform；
 * 一旦被放进 `enter-fade-up` 那类带动画的容器里，fixed 就会相对那个容器定位、跑到正文里，
 * 所以这里刻意保持「扁平」。
 *
 * 节日装饰也从这里出：两侧留白轨道（≥1536px 才有空间）在每一页都可用，
 * 不再是文章页专属；内容区宽度、间距、换行都不受影响，关掉主题即恢复。
 */
function DecorStack({ items, side }: { items: ThemeDecorItem[], side: 'left' | 'right' }) {
  return (
    <div className={cn('pb-rail', side === 'left' ? 'pb-rail-left' : 'pb-rail-right')}>
      {items.map((item, index) => {
        const Glyph = getThemeDecor(item.glyph)
        return (
          <div
            key={`${item.glyph}-${index}`}
            className="pb-rail-item"
            style={{
              'width': item.size,
              'height': item.size,
              'left': `${item.x}%`,
              'top': `${item.y}%`,
              'opacity': item.opacity ?? 1,
              // 旋转放外层，内层只负责漂浮动画，两者互不覆盖
              '--gutter-rotate': `${item.rotate ?? 0}deg`,
              '--gutter-scale': item.flip ? -1 : 1,
            } as React.CSSProperties}
          >
            <Glyph
              className="pb-rail-art"
              style={{
                width: '100%',
                height: '100%',
                animationDelay: `${(index * -2.3).toFixed(1)}s`,
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

export function PageBackground() {
  const { background, slots } = usePageBackground()
  const { theme, enabled: themeEnabled } = useTheme()

  const left = themeEnabled ? (theme?.decorLeft ?? []) : []
  const right = themeEnabled ? (theme?.decorRight ?? []) : []
  const showDecor = background.decorations && (left.length > 0 || right.length > 0)
  const hasSlots = Boolean(slots.base || slots.overlay || slots.left || slots.right)
  // enabled 只管「自定义底色 / 背景图」；节日装饰有自己的 decorations 开关，两者互不牵连
  const hasImage = background.enabled && Boolean(background.image)
  const hasColor = background.enabled && Boolean(background.color)
  // 蒙版颜色单独也能顶一个纯色背景，所以它自己也算「有内容」
  const hasVeilColor = background.enabled && Boolean(background.veilColor)

  if (!hasImage && !hasColor && !hasVeilColor && !showDecor && !hasSlots)
    return null

  return (
    <div aria-hidden className="pb-root">
      {/* 底色：缺省用主题的 --background，因此明暗切换与节日配色变化都会自动跟随 */}
      <div className="pb-color" style={hasColor ? { background: background.color } : undefined} />

      {/* 任意内容：最底层，遮在底色之上、背景图之下（渐变 div、色块、视频等） */}
      {slots.base && <div className="pb-slot-base">{slots.base}</div>}

      {hasImage && background.image && (
        <div
          className="pb-image"
          style={{
            backgroundImage: `url("${background.image.src}")`,
            backgroundPosition: background.image.position,
            backgroundSize: background.image.size,
            filter: background.image.blur > 0 ? `blur(${background.image.blur}px)` : undefined,
            // 模糊会把边缘糊掉，稍微放大盖住
            transform: background.image.blur > 0 ? `scale(${1 + background.image.blur / 60})` : undefined,
            opacity: background.image.opacity,
          }}
        />
      )}

      {/*
        * 蒙版：有背景图时压住图片保证正文对比度；没有背景图时它就是纯色背景
        * （颜色 × 不透明度 直接铺在底色上）。颜色留空则由 CSS 回退到 var(--background)。
        */}
      {(hasImage || hasVeilColor) && (
        <div
          className="pb-veil"
          style={{
            opacity: background.veil,
            ...(background.veilColor ? { '--pb-veil-color': background.veilColor } : {}),
          } as React.CSSProperties}
        />
      )}

      {/* 任意内容：背景图与遮罩之上的整屏覆盖层（噪点、暗角…） */}
      {slots.overlay && <div className="pb-slot-overlay">{slots.overlay}</div>}

      {/* 节日装饰：两侧留白轨道 */}
      {showDecor && left.length > 0 && <DecorStack items={left} side="left" />}
      {showDecor && right.length > 0 && <DecorStack items={right} side="right" />}

      {/* 任意内容：两侧轨道，追加在节日装饰之后，由调用方决定画什么 */}
      {slots.left && <div className="pb-rail pb-rail-left">{slots.left}</div>}
      {slots.right && <div className="pb-rail pb-rail-right">{slots.right}</div>}
    </div>
  )
}
