'use client'

import { SafeImage } from '@/components/common/safe-image'
import { cn } from '@/lib/utils'

/**
 * 播放器页的动态背景（第一期，见 spec 8.10）：放大并高度模糊的封面 + 压暗遮罩，切歌时淡入新封面。
 * 模糊后看不出细节，只请求小尺寸图片；压暗遮罩保证任意封面配色下白色歌词都可读。
 * contained 时铺满最近的定位祖先（悬浮播放器的卡片），否则铺满视口
 */
export function MusicBackground({ cover, contained = false }: { cover?: string, contained?: boolean }) {
  return (
    <div aria-hidden className={cn('pointer-events-none inset-0 overflow-hidden bg-neutral-950', contained ? 'absolute' : 'fixed')}>
      {cover && (
        <SafeImage
          // 换封面时重新挂载以触发淡入
          key={cover}
          src={cover}
          alt=""
          fill
          sizes="256px"
          fallback={null}
          className="scale-125 animate-in object-cover opacity-80 blur-3xl saturate-150 duration-1000 fade-in"
        />
      )}
      <div className="absolute inset-0 bg-black/50" />
    </div>
  )
}
