'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { useMusicPreferences } from '@/contexts/music-context'
import { hdrColorUrl } from '@/lib/hdr-color'

const HDR_QUERY = '(dynamic-range: high)'

function subscribe(listener: () => void) {
  const mql = window.matchMedia(HDR_QUERY)
  mql.addEventListener('change', listener)
  return () => mql.removeEventListener('change', listener)
}

/** 当前屏幕是否支持 HDR（窗口拖到另一块屏幕时会变化） */
export function useHdrDisplay() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(HDR_QUERY).matches, () => false)
}

/** 音乐播放器的 HDR 高光是否生效：读者开着 HDR 高光，且屏幕支持 HDR */
export function useHdrEnabled() {
  const { hdr } = useMusicPreferences()
  return useHdrDisplay() && hdr
}

/**
 * 音乐播放器的 HDR 高光素材（CSS 的 url()）：读者开着 HDR 高光、且屏幕支持 HDR 时，返回 color 按 gain 倍 SDR 白亮度生成的素材，否则为 null。
 * 用作 background-image（配合 background-clip: text 可作用于文字），见 lib/hdr-color.ts
 */
export function useHdrHighlight(color: string | null | undefined, gain: number) {
  const enabled = useHdrEnabled()
  return useMemo(() => {
    if (!enabled || !color)
      return null
    const url = hdrColorUrl(color, gain)
    return url ? `url("${url}")` : null
  }, [color, enabled, gain])
}
