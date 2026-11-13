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

  it('音译取罗马音那组（ja-Latn）的带时间分段，假名读音不当音译', () => {
    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
<head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations>
  <transliteration xml:lang="ja"><text for="L1"><span begin="1.000" end="1.600">ひかり</span></text></transliteration>
  <transliteration xml:lang="ja-Latn"><text for="L1"><span begin="1.000" end="1.600">hi ka ri</span> <span begin="1.600" end="1.900">chi</span></text></transliteration>
</transliterations></iTunesMetadata></metadata></head>
<body><div><p begin="1.000" end="1.900" itunes:key="L1"><span begin="1.000" end="1.600">光</span><span begin="1.600" end="1.900">散</span></p></div></body></tt>`
    const [line] = parseTtml(ttml, 'ttml-amll')!.lines
    expect(line.romanization).toBe('hi ka ri chi')
    expect(line.romanizationWords?.map(part => [part.text, part.word, part.start, part.end])).toEqual([
      ['hi', 0, 1000, 1200],
      ['ka', 0, 1200, 1400],
      ['ri', 0, 1400, 1600],
      ['chi', 1, 1600, 1900],
    ])
    // 预处理去掉空音节后，音译重新对应到原来的字
    const withEmpty = ttml.replace('<span begin="1.000" end="1.600">光</span>', '<span begin="0.900" end="1.000"></span><span begin="1.000" end="1.600">光</span>')
    const [shifted] = parseTtml(withEmpty, 'ttml-amll')!.lines
    expect(shifted.words.map(word => word.text)).toEqual(['光', '散'])
    expect(shifted.romanizationWords?.map(part => part.word)).toEqual([0, 0, 0, 1])
  })

  it('解析日语振假名（tts:ruby container/base/textContainer/text/delimiter）且不混入正文', () => {
    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling">
<body><div>
  <p begin="00:10.000" end="00:11.200">
    <span tts:ruby="container" begin="00:10.000" end="00:10.600">
      <span tts:ruby="base">明日</span>
      <span tts:ruby="delimiter">（</span>
      <span tts:ruby="textContainer">
        <span tts:ruby="text" begin="00:10.000" end="00:10.200">あ</span>
        <span tts:ruby="text" begin="00:10.200" end="00:10.400">し</span>
        <span tts:ruby="text" begin="00:10.400" end="00:10.600">た</span>
      </span>
      <span tts:ruby="delimiter">）</span>
    </span><span begin="00:10.600" end="00:10.800">へ</span><span tts:ruby="container" begin="00:10.800" end="00:11.200"><span tts:ruby="base">行</span><span tts:ruby="text">ゆ</span></span>
  </p>
</div></body></tt>`
    const [line] = parseTtml(ttml, 'ttml-amll')!.lines
    expect(line.words.map(word => word.text)).toEqual(['明日', 'へ', '行'])
    expect(line.words[0].ruby).toEqual([
      { text: 'あ', start: 10000, end: 10200 },
      { text: 'し', start: 10200, end: 10400 },
      { text: 'た', start: 10400, end: 10600 },
    ])
    expect(line.words[1].ruby).toBeUndefined()
    expect(line.words[2].ruby).toEqual([
      { text: 'ゆ', start: 10800, end: 11200 },
    ])
  })
})
