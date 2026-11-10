import { describe, expect, it } from 'vitest'
import { getLocaleMessages } from '@/locales'
import { loadMessageUnit, messagePath, readableFallback } from './fallback'

describe('文案缺失兜底', () => {
  it('键名转成可读文本，不显示命名空间路径', () => {
    expect(readableFallback('Console.global.ncm_song_level_exhigh')).toBe('Ncm song level exhigh')
    expect(readableFallback('Comment.reply')).toBe('Reply')
    expect(messagePath('Comment', 'reply')).toBe('Comment.reply')
    expect(messagePath(undefined, 'Comment.reply')).toBe('Comment.reply')
  })

  it('按需加载缺失文案所在的整个下发单元，并按回退链合并', async () => {
    const full = getLocaleMessages('zh-HK') as Record<string, Record<string, unknown>>
    // 普通命名空间整棵加载
    expect(await loadMessageUnit('zh-HK', 'Comment.reply')).toEqual({ Comment: full.Comment })
    // Console 只加载对应的子命名空间
    expect(await loadMessageUnit('zh-HK', 'Console.global.title')).toEqual({ Console: { global: full.Console.global } })
    expect(await loadMessageUnit('en', 'NoSuchNamespace.key')).toBeNull()
  })
})
