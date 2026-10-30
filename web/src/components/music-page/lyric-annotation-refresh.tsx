'use client'

import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { fetchLyricAnnotations } from '@/api/music'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { refreshAnnotations, useLyricAnnotations } from '@/contexts/lyric-annotations'
import { useMusic } from '@/contexts/music-context'
import { cn } from '@/lib/utils'
import { isAdmin } from '@/utils/common/permission'

/**
 * 重新生成 AI 歌词特效（歌词标注）：仅管理员可见（后端接口同样限管理员），只对逐字歌词、开启了歌词特效且显示的是全站歌词版本时显示
 * （特效只按全站版本生成）。
 * 点击后后台重新生成，新结果生成前继续使用旧结果，生成完成后自动替换；在后台手动编辑过的标注会被覆盖，先确认。
 * 标注要开始播放才会请求，暂停时还不知道是否编辑过，点击时先查询一次
 */
export function LyricAnnotationRefresh({ className }: { className?: string }) {
  const t = useTranslations('MusicPage')
  const { user } = useAuth()
  const { currentTrack, lyrics, showLyricEffects, lyricIsSiteVersion } = useMusic()
  const [refreshing, setRefreshing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const trackId = currentTrack?.id ?? 0
  const edited = useLyricAnnotations(trackId > 0 ? trackId : null)?.edited ?? false
  if (!user || !isAdmin({ user }) || trackId <= 0 || !lyrics.wordTimed || !showLyricEffects || !lyricIsSiteVersion)
    return null

  const refresh = async () => {
    setRefreshing(true)
    try {
      await refreshAnnotations(trackId)
      toast.success(t('lyric_ai_refresh_started'))
    }
    catch {
      toast.error(t('lyric_ai_refresh_failed'))
    }
    finally {
      setRefreshing(false)
    }
  }

  const onClick = async () => {
    setRefreshing(true)
    const current = edited ? null : await fetchLyricAnnotations(trackId).catch(() => null)
    setRefreshing(false)
    if (edited || current?.edited)
      setConfirmOpen(true)
    else
      void refresh()
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title={t('lyric_ai_refresh')}
        aria-label={t('lyric_ai_refresh')}
        disabled={refreshing}
        onClick={() => void onClick()}
        className={cn('size-[1.125rem] rounded-full bg-white/10 text-white/70 hover:bg-white/15 hover:text-white/90', className)}
      >
        <RefreshCwIcon aria-hidden className={cn('size-2.5', refreshing && 'motion-safe:animate-spin')} />
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('lyric_ai_refresh_edited_title')}
        description={t('lyric_ai_refresh_edited_description')}
        confirmLabel={t('lyric_ai_refresh')}
        confirmVariant="destructive"
        onConfirm={refresh}
      />
    </>
  )
}
