import { describe, expect, it } from 'vitest'
import { parseTtml, parseTtmlTime } from './parse-ttml'
import { decodeSharedRubyText, decodeSharedRubyTimes, retimePlaceholderWords } from './ttml-ruby'

describe('兼容 StarryPlayer TTML 振假名、占位时间与扩展结构', () => {
  it('解码 ttx:rubyText 与 ttx:rubyTimes（转义符、英文词间空格与非法段校验）', () => {
    expect(decodeSharedRubyText('あ|し|た')).toEqual(['あ', 'し', 'た'])
    expect(decodeSharedRubyText('eternal |love')).toEqual(['eternal ', 'love'])
    expect(decodeSharedRubyText('a\\|b|c\\\\d')).toEqual(['a|b', 'c\\d'])
    expect(decodeSharedRubyText('あ||た')).toBeNull()

    expect(decodeSharedRubyTimes('00:01.000,00:01.300 00:01.300,00:01.600', parseTtmlTime)).toEqual([
      { start: 1000, end: 1300 },
      { start: 1300, end: 1600 },
    ])
    expect(decodeSharedRubyTimes('00:02.000,00:01.000', parseTtmlTime)).toBeNull()
  })

  it('兼容 StarryPlayer .amll 默认导出的无外层时间单音节 ruby 容器与 ttx:rubyGroup 跨音节共享振假名', () => {
    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttx="urn:ttml:extensions:shared-ruby:1">
<body><div>
  <p begin="00:01.000" end="00:03.200">
    <span tts:ruby="container"><span tts:ruby="base">明日</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="00:01.000" end="00:01.200">あ</span><span tts:ruby="text" begin="00:01.200" end="00:01.400">し</span><span tts:ruby="text" begin="00:01.400" end="00:01.600">た</span></span></span><span begin="00:01.600" end="00:01.800">も</span><span begin="00:01.800" end="00:02.300" ttx:rubyGroup="1" ttx:rubyText="きょ|う" ttx:rubyTimes="00:01.800,00:02.200 00:02.200,00:02.600">今</span><span begin="00:02.300" end="00:02.600" ttx:rubyGroup="1">日</span><span begin="00:02.600" end="00:03.200">も</span>
  </p>
</div></body></tt>`
    const parsed = parseTtml(ttml, 'ttml-custom')!
    const [line] = parsed.lines
    expect(line.words.map(w => [w.text, w.start, w.end])).toEqual([
      ['明日', 1000, 1600],
      ['も', 1600, 1800],
      ['今日', 1800, 2600],
      ['も', 2600, 3200],
    ])
    expect(line.words[0].ruby).toEqual([
      { text: 'あ', start: 1000, end: 1200 },
      { text: 'し', start: 1200, end: 1400 },
      { text: 'た', start: 1400, end: 1600 },
    ])
    expect(line.words[2].ruby).toEqual([
      { text: 'きょ', start: 1800, end: 2200 },
      { text: 'う', start: 2200, end: 2600 },
    ])
  })

  it('兼容 StarryPlayer .ttml2 导出的内嵌子 <span> 时间多音节 ruby 容器', () => {
    const ttml2 = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling">
<body><div>
  <p begin="00:05.000" end="00:06.200">
    <span tts:ruby="container"><span tts:ruby="base"><span begin="00:05.000" end="00:05.400">大</span><span begin="00:05.400" end="00:05.900">人</span></span><span tts:ruby="text"><span begin="00:05.000" end="00:05.300">お</span><span begin="00:05.300" end="00:05.600">と</span><span begin="00:05.600" end="00:05.900">な</span></span></span><span begin="00:05.900" end="00:06.200">に</span>
  </p>
</div></body></tt>`
    const [line] = parseTtml(ttml2, 'ttml-custom')!.lines
    expect(line.words.map(w => [w.text, w.start, w.end])).toEqual([
      ['大人', 5000, 5900],
      ['に', 5900, 6200],
    ])
    expect(line.words[0].ruby).toEqual([
      { text: 'お', start: 5000, end: 5300 },
      { text: 'と', start: 5300, end: 5600 },
      { text: 'な', start: 5600, end: 5900 },
    ])
  })

  it('兼容连续 00:00.000 占位单调均分、<p 00:00.000> 占位忽略、多段/纯文本 x-bg 合并与纯 x-bg 行提升为主行', () => {
    // 连续两个占位夹在 1800ms 与 2000ms 之间：应单调均分为 1800..1900 与 1900..2000，不倒退覆盖前词
    const retimed = retimePlaceholderWords([
      { text: '前', start: 1000, end: 1800 },
      { text: '占1', start: 0, end: 0 },
      { text: '占2', start: 0, end: 0 },
      { text: '后', start: 2000, end: 2500 },
    ], 1000, 2500)
    expect(retimed.map(w => [w.text, w.start, w.end])).toEqual([
      ['前', 1000, 1800],
      ['占1', 1800, 1900],
      ['占2', 1900, 2000],
      ['后', 2000, 2500],
    ])

    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<body><div>
  <p begin="00:02.000" end="00:04.000">
    <span begin="00:02.000" end="00:03.000">主句</span>
    <span ttm:role="x-bg"><span begin="00:03.100" end="00:03.400">oh</span></span> <span ttm:role="x-bg"><span begin="00:03.400" end="00:03.800">yeah</span></span>
  </p>
  <p begin="00:00.000" end="00:00.000">
    <span begin="00:05.000" end="00:06.000">忽略零占位段界</span>
    <span ttm:role="x-bg" begin="00:06.100" end="00:06.600">(纯文本和声)</span>
  </p>
  <p begin="00:08.000" end="00:09.500">
    <span ttm:role="x-bg"><span begin="00:08.200" end="00:09.200">(独立回声行)</span></span>
  </p>
</div></body></tt>`
    const parsed = parseTtml(ttml, 'ttml-amll')!
    expect(parsed.lines.map(l => [l.words.map(w => w.text).join(''), l.isBackground, l.words[0].start, l.end])).toEqual([
      ['主句', false, 2000, 4000],
      ['oh yeah', true, 3100, 3800],
      ['忽略零占位段界', false, 5000, 6000],
      ['(纯文本和声)', true, 6100, 6600],
      ['(独立回声行)', false, 8200, 9500],
    ])
    // 第二句主行没有被 <p begin="00:00.000"> 拉回 0ms，也未抢占第一句后置和声（3800ms）之前的窗口
    expect(parsed.lines[2].start).toBe(4400)
  })
})
