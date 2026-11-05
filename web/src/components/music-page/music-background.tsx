'use client'

import { SafeImage } from '@/components/common/safe-image'
import { cn } from '@/lib/utils'

/**
 * 播放器页的动态背景（第一期，见 spec 8.10）：放大并高度模糊的封面 + 压暗遮罩，切歌时淡入新封面。
 * 模糊后看不出细节，只请求小尺寸图片；压暗遮罩保证任意封面配色下白色歌词都可读。
 * contained 时铺满最近的定位祖先（悬浮播放器的卡片），否则铺满视口；imageClassName 用于调整封面的样式（如很小的区域里减小模糊半径）；
 * morphBackdrop 时标为顶栏灵动岛展开形变的底色：形变的外壳复制它，胶囊比面板宽出来的部分也是模糊封面而不是纯色（见 topbar-island/island-morph.ts）
 */
export function MusicBackground({ cover, contained = false, imageClassName, morphBackdrop = false }: { cover?: string, contained?: boolean, imageClassName?: string, morphBackdrop?: boolean }) {
  return (
    // 播放器页副歌开唱时的镜头推近：data-stage-push 为推近到底时多放大的比例，由 MusicStageEffects 逐帧写入 scale；
    // 单独成为合成层，缩放只改合成参数，不重绘模糊的封面；小窗不推近
    <div
      aria-hidden
      data-stage-push={contained ? undefined : 0.06}
      data-island-morph-bg={morphBackdrop ? '' : undefined}
      className={cn('pointer-events-none inset-0 overflow-hidden bg-neutral-950', contained ? 'absolute' : 'fixed will-change-[scale]')}
    >
      {cover && (
        <SafeImage
          // 换封面时重新挂载以触发淡入
          key={cover}
          src={cover}
          alt=""
          fill
          sizes="256px"
          fallback={null}
          className={cn('scale-125 animate-in object-cover opacity-80 blur-3xl saturate-150 duration-1000 fade-in', imageClassName)}
        />
      )}
      <div className="absolute inset-0 bg-black/50" />
    </div>
  )
}
