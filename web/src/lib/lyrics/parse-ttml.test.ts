import { describe, expect, it } from 'vitest'
import { parseTtml, parseTtmlTime } from './parse-ttml'

const TTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
<head><metadata>
  <ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/>
  <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
    <translations><translation><text for="L2">second line</text></translation></translations>
  </iTunesMetadata>
</metadata></head>
<body><div>
  <p begin="00:01.000" end="00:03.000" ttm:agent="v1" itunes:key="L1"><span begin="00:01.000" end="00:01.500">Hello</span> <span begin="00:01.500" end="00:02.000">world</span><span ttm:role="x-translation">你好世界</span><span ttm:role="x-bg"><span begin="00:02.200" end="00:02.800">(ooh)</span></span></p>
  <p begin="00:04.000" end="00:06.000" ttm:agent="v2" itunes:key="L2"><span begin="00:00.000" end="00:00.000">占</span><span begin="00:05.000" end="00:05.500">位</span></p>
</div></body></tt>`

describe('解析 TTML 歌词', () => {
  it('时间格式', () => {
    expect(parseTtmlTime('00:20.686')).toBe(20686)
    expect(parseTtmlTime('01:00:01.5')).toBe(3601500)
    expect(parseTtmlTime('12.5s')).toBe(12500)
    expect(parseTtmlTime('300ms')).toBe(300)
    expect(parseTtmlTime('bad')).toBeNull()
  })

  it('音节、词间空格、翻译、背景人声与对唱', () => {
    const lyrics = parseTtml(TTML, 'ttml-amll')!
    expect(lyrics.source).toBe('ttml-amll')
    expect(lyrics.wordTimed).toBe(true)
    const [first, background, second] = lyrics.lines
    expect(first.words.map(word => word.text)).toEqual(['Hello ', 'world'])
    expect(first.translation).toBe('你好世界')
    expect(first.isDuet).toBe(false)
    expect(background.isBackground).toBe(true)
    expect(background.words[0]).toMatchObject({ text: '(ooh)', start: 2200, end: 2800 })
    // head 中按 itunes:key 提供的翻译；v2 为对唱
    expect(second.translation).toBe('second line')
    expect(second.isDuet).toBe(true)
  })

  it('修复 AMLL 的 00:00.000 占位时间', () => {
    const second = parseTtml(TTML, 'ttml-amll')!.lines[2]
    expect(second.words[0]).toMatchObject({ text: '占', start: 4500, end: 5000 })
  })

  it('不是 TTML 时返回 null', () => {
    expect(parseTtml('<html><body/></html>', 'ttml-custom')).toBeNull()
    expect(parseTtml('not xml', 'ttml-custom')).toBeNull()
  })
})
