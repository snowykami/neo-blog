import type { MusicLyricTranslationStreamEvent } from '@/api/music'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  refreshTranslations,
  requestLyricTranslations,
  resetLyricTranslationsStoreForTest,
  useLyricTranslations,
  useLyricTranslationsGenerating,
} from './lyric-translations'

const api = vi.hoisted(() => ({
  fetchLyricTranslations: vi.fn(),
  streamLyricTranslations: vi.fn(),
  refreshLyricTranslations: vi.fn(),
}))

vi.mock('@/api/music', () => ({
  fetchLyricTranslations: api.fetchLyricTranslations,
  streamLyricTranslations: api.streamLyricTranslations,
  refreshLyricTranslations: api.refreshLyricTranslations,
}))

vi.mock('react', () => ({
  useEffect: () => {},
  useSyncExternalStore: (_sub: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('歌词翻译外部 Store（冷热分流与流式更新）', () => {
  beforeEach(() => {
    resetLyricTranslationsStoreForTest()
    api.fetchLyricTranslations.mockReset()
    api.streamLyricTranslations.mockReset()
    api.refreshLyricTranslations.mockReset()
  })

  it('热路径命中 ready 缓存时直接落盘，不建立 SSE 连接', async () => {
    api.fetchLyricTranslations.mockResolvedValue({
      status: 'ready',
      source: 'ncm-lrc',
      targetLang: 'zh',
      lines: [{ text: 'Hello', occurrence: 0, translation: '你好' }],
    })

    requestLyricTranslations(11, 'ncm-lrc', 'zh')
    await flushMicrotasks()

    expect(api.streamLyricTranslations).not.toHaveBeenCalled()
    expect(useLyricTranslations(11, 'ncm-lrc', 'zh')?.lines).toEqual([
      { text: 'Hello', occurrence: 0, translation: '你好' },
    ])
    expect(useLyricTranslationsGenerating(11, 'ncm-lrc', 'zh')).toBe(false)
  })

  it('冷路径返回 pending 时开启 SSE，逐行累加并在 done 后结束生成状态', async () => {
    api.fetchLyricTranslations.mockResolvedValue({
      status: 'pending',
      source: 'ncm-lrc',
      targetLang: 'zh',
      lines: [],
    })

    let pushEvent: ((ev: MusicLyricTranslationStreamEvent) => void) | null = null
    let resolveStream: ((ok: boolean) => void) | null = null
    api.streamLyricTranslations.mockImplementation(
      (_id: number, _src: string, _lang: string, opts: { onEvent: (ev: MusicLyricTranslationStreamEvent) => void }) => {
        pushEvent = opts.onEvent
        return new Promise<boolean>((resolve) => {
          resolveStream = resolve
        })
      },
    )

    requestLyricTranslations(12, 'ncm-lrc', 'zh')
    await flushMicrotasks()

    expect(api.streamLyricTranslations).toHaveBeenCalledTimes(1)
    expect(useLyricTranslationsGenerating(12, 'ncm-lrc', 'zh')).toBe(true)

    pushEvent!({ event: 'replay', lines: [{ text: 'Line 1', occurrence: 0, translation: '第一行' }] })
    expect(useLyricTranslations(12, 'ncm-lrc', 'zh')?.lines).toHaveLength(1)
    expect(useLyricTranslationsGenerating(12, 'ncm-lrc', 'zh')).toBe(true)

    pushEvent!({ event: 'line', line: { text: 'Line 2', occurrence: 0, translation: '第二行' } })
    expect(useLyricTranslations(12, 'ncm-lrc', 'zh')?.lines.map(l => l.translation)).toEqual(['第一行', '第二行'])

    pushEvent!({ event: 'done', meta: { status: 'ready', source: 'ncm-lrc', targetLang: 'zh' } })
    resolveStream!(true)
    await flushMicrotasks()

    expect(useLyricTranslationsGenerating(12, 'ncm-lrc', 'zh')).toBe(false)
    expect(useLyricTranslations(12, 'ncm-lrc', 'zh')?.lines).toHaveLength(2)
  })

  it('sse 推送 error 后进入失败冷却窗口；手动 refresh 可绕过冷却重新拉流', async () => {
    api.fetchLyricTranslations.mockResolvedValue({
      status: 'pending',
      source: 'ncm-lrc',
      targetLang: 'zh',
      lines: [],
    })
    api.streamLyricTranslations.mockImplementation(
      async (_id: number, _src: string, _lang: string, opts: { onEvent: (ev: MusicLyricTranslationStreamEvent) => void }) => {
        opts.onEvent({ event: 'error', message: 'upstream 502' })
        return false
      },
    )

    requestLyricTranslations(13, 'ncm-lrc', 'zh')
    await flushMicrotasks()

    expect(useLyricTranslationsGenerating(13, 'ncm-lrc', 'zh')).toBe(false)
    expect(api.fetchLyricTranslations).toHaveBeenCalledTimes(1)

    // 冷却期内再次触发不会重复请求后端
    requestLyricTranslations(13, 'ncm-lrc', 'zh')
    await flushMicrotasks()
    expect(api.fetchLyricTranslations).toHaveBeenCalledTimes(1)

    api.refreshLyricTranslations.mockResolvedValue({
      status: 'pending',
      source: 'ncm-lrc',
      targetLang: 'zh',
      lines: [],
    })
    api.streamLyricTranslations.mockImplementation(
      async (_id: number, _src: string, _lang: string, opts: { onEvent: (ev: MusicLyricTranslationStreamEvent) => void }) => {
        opts.onEvent({ event: 'line', line: { text: 'Line 1', occurrence: 0, translation: '重试成功' } })
        opts.onEvent({ event: 'done', meta: { status: 'ready', source: 'ncm-lrc', targetLang: 'zh' } })
        return true
      },
    )

    await expect(refreshTranslations(13, 'ncm-lrc', 'zh')).resolves.toBe('started')
    await flushMicrotasks()

    expect(useLyricTranslationsGenerating(13, 'ncm-lrc', 'zh')).toBe(false)
    expect(useLyricTranslations(13, 'ncm-lrc', 'zh')?.lines[0]?.translation).toBe('重试成功')
  })
})
