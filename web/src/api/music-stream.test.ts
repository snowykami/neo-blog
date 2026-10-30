import type { MusicLyricStreamEvent } from './music'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamSongLyrics } from './music'

const client = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./client', () => ({ default: client }))

/** 把文本按给定的切分点分块推送的流（模拟网络分包） */
function textStream(text: string, cuts: number[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  const points = [0, ...cuts, bytes.length]
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i + 1 < points.length; i++)
        controller.enqueue(bytes.slice(points[i], points[i + 1]))
      controller.close()
    },
  })
}

describe('歌词流（SSE）', () => {
  beforeEach(() => client.get.mockReset())

  it('逐条解析事件（数据转换为 camelCase），收到 done 时返回 true', async () => {
    const body = [
      'event: cache\ndata: {"kind":"qq","qq":{"song_mid":"001","format":"qrc","lyric":"[0,1]a(0,1)","translation":"","romanization":""}}\n\n',
      'event: source\ndata: {"kind":"ttml","data":{"source":"amll","ttml":"<tt/>"}}\n\n',
      'event: source\ndata: {"kind":"kugou","data":null,"failed":true}\n\n',
      'event: source\ndata: {"kind":"evil","data":{}}\n\n',
      'event: decided\r\ndata: {"kind":"ttml","source":"ttml-amll"}\r\n\r\n',
      'event: done\ndata: {}\n\n',
    ].join('')
    client.get.mockResolvedValue({ data: textStream(body, [7, 50, 123, 200]) })
    const events: MusicLyricStreamEvent[] = []
    await expect(streamSongLyrics(476513774, { refresh: true, onEvent: event => events.push(event) })).resolves.toBe(true)
    expect(client.get).toHaveBeenCalledWith('/music/song/476513774/lyric/stream', expect.objectContaining({ adapter: 'fetch', responseType: 'stream', params: { refresh: 1 } }))
    expect(events).toEqual([
      { event: 'cache', cache: { kind: 'qq', qq: { songMid: '001', format: 'qrc', lyric: '[0,1]a(0,1)', translation: '', romanization: '' } } },
      { event: 'source', kind: 'ttml', data: { source: 'amll', ttml: '<tt/>' }, failed: false },
      { event: 'source', kind: 'kugou', data: null, failed: true },
      { event: 'decided', version: { kind: 'ttml', source: 'ttml-amll' } },
      { event: 'done' },
    ])
  })

  it('请求失败或在 done 之前结束时返回 false', async () => {
    client.get.mockRejectedValue(new Error('network'))
    await expect(streamSongLyrics(1, { onEvent: () => {} })).resolves.toBe(false)
    client.get.mockResolvedValue({ data: textStream('event: source\ndata: {"kind":"ncm","data":null}\n\n', []) })
    const events: MusicLyricStreamEvent[] = []
    await expect(streamSongLyrics(1, { onEvent: event => events.push(event) })).resolves.toBe(false)
    expect(events).toHaveLength(1)
  })
})
