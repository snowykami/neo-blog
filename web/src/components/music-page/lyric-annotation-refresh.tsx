'use client'

import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { refreshAnnotations } from '@/contexts/lyric-annotations'
import { useMusic } from '@/contexts/music-context'
import { cn } from '@/lib/utils'
import { isAdmin } from '@/utils/common/permission'

/**
 * 重新生成 AI 歌词特效（歌词标注）：仅管理员可见（后端接口同样限管理员），只对逐字歌词且开启了歌词特效时显示。
 * 点击后后台重新生成，新结果生成前继续使用旧结果，生成完成后自动替换
 */
export function LyricAnnotationRefresh({ className }: { className?: string }) {
  const t = useTranslations('MusicPage')
  const { user } = useAuth()
  const { currentTrack, lyrics, showLyricEffects } = useMusic()
  const [refreshing, setRefreshing] = useState(false)
  const trackId = currentTrack?.id ?? 0
  if (!user || !isAdmin({ user }) || trackId <= 0 || !lyrics.wordTimed || !showLyricEffects)
    return null

  const refresh = () => {
    setRefreshing(true)
    refreshAnnotations(trackId)
      .then(() => toast.success(t('lyric_ai_refresh_started')))
      .catch(() => toast.error(t('lyric_ai_refresh_failed')))
      .finally(() => setRefreshing(false))
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={t('lyric_ai_refresh')}
      aria-label={t('lyric_ai_refresh')}
      disabled={refreshing}
      onClick={refresh}
      className={cn('size-[1.125rem] rounded-full bg-white/10 text-white/70 hover:bg-white/15 hover:text-white/90', className)}
    >
      <RefreshCwIcon aria-hidden className={cn('size-2.5', refreshing && 'motion-safe:animate-spin')} />
    </Button>
  )
}
