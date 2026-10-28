'use client'

import { useEffect } from 'react'
import { useMusic } from '@/contexts/music-context'

const SEEK_STEP_SECONDS = 5
const VOLUME_STEP = 0.1

/**
 * 播放器页键盘操作：空格播放 / 暂停，← / → 快退 / 快进，↑ / ↓ 调节音量
 * 焦点在输入框、滑块中时交给它们自己处理；焦点在按钮、链接上时空格保留原生的点击
 */
export function useMusicHotkeys() {
  const { togglePlay, seek, getAudio, volume, setVolume } = useMusic()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
        return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="dialog"]'))
        return
      const audio = getAudio()
      switch (event.key) {
        case ' ':
          if (target?.closest('button, a'))
            return
          togglePlay()
          break
        case 'ArrowLeft':
          if (audio)
            seek(Math.max(0, audio.currentTime - SEEK_STEP_SECONDS))
          break
        case 'ArrowRight':
          if (audio)
            seek(audio.currentTime + SEEK_STEP_SECONDS)
          break
        case 'ArrowUp':
          setVolume(Math.min(1, volume + VOLUME_STEP))
          break
        case 'ArrowDown':
          setVolume(Math.max(0, volume - VOLUME_STEP))
          break
        default:
          return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [getAudio, seek, setVolume, togglePlay, volume])
}
