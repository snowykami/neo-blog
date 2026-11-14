import { describe, expect, it } from 'vitest'
import { LYRIC_COLORS } from './colors'
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

  it('合唱居中（group / 多 agent）、祖先 ttm:agent 继承与背景人声独立演唱者', () => {
    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata>
  <ttm:agent type="person" xml:id="v1"/>
  <ttm:agent type="person" xml:id="v2"/>
  <ttm:agent type="group" xml:id="v1000"/>
</metadata></head>
<body>
  <div ttm:agent="v1">
    <p begin="00:01.000" end="00:02.000">
      <span begin="00:01.000" end="00:02.000">主唱继承div</span>
      <span ttm:role="x-bg" ttm:agent="v2"><span begin="00:01.500" end="00:01.900">(对唱和声)</span></span>
    </p>
    <p begin="00:03.000" end="00:04.000" ttm:agent="v1000"><span begin="00:03.000" end="00:04.000">群组合唱</span></p>
    <p begin="00:05.000" end="00:06.000" ttm:agent="v1 v2"><span begin="00:05.000" end="00:06.000">双人同唱</span></p>
  </div>
  <div ttm:agent="v2">
    <p begin="00:07.000" end="00:08.000"><span begin="00:07.000" end="00:08.000">对唱继承div</span></p>
  </div>
</body></tt>`
    const parsed = parseTtml(ttml, 'ttml-amll')!
    const [inheritedMain, bgOverride, groupChorus, multiAgentChorus, inheritedDuet] = parsed.lines
    expect(inheritedMain.align).toBe('left')
    expect(inheritedMain.isDuet).toBe(false)
    expect(inheritedMain.paragraphStart).toBeUndefined()
    expect(bgOverride.isBackground).toBe(true)
    expect(bgOverride.align).toBe('right')
    expect(bgOverride.isDuet).toBe(true)
    expect(bgOverride.backgroundPosition).toBe('below')
    expect(groupChorus.align).toBe('center')
    expect(groupChorus.isDuet).toBe(false)
    expect(multiAgentChorus.align).toBe('center')
    expect(multiAgentChorus.isDuet).toBe(false)
    expect(inheritedDuet.align).toBe('right')
    expect(inheritedDuet.isDuet).toBe(true)
    expect(inheritedDuet.paragraphStart).toBe(true)
  })

  it('解析 head 中背景人声（x-bg）音译与翻译且不混入主行，并区分前后背景位置', () => {
    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
<head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
  <translations><translation>
    <text for="L1">光明<span ttm:role="x-bg">(微光)</span></text>
  </translation></translations>
  <transliterations><transliteration xml:lang="ja-Latn">
    <text for="L1"><span begin="2.000" end="2.500">hi ka ri</span> <span ttm:role="x-bg"><span begin="1.200" end="1.800">(a ha)</span></span></text>
  </transliteration></transliterations>
</iTunesMetadata></metadata></head>
<body><div>
  <p begin="1.200" end="3.000" itunes:key="L1">
    <span begin="2.000" end="2.500">光</span>
    <span ttm:role="x-bg"><span begin="1.200" end="1.800">(あは)</span></span>
  </p>
</div></body></tt>`
    const parsed = parseTtml(ttml, 'ttml-amll')!
    const [bg, main] = parsed.lines
    expect(bg.isBackground).toBe(true)
    expect(bg.backgroundPosition).toBe('above')
    expect(bg.translation).toBe('(微光)')
    expect(bg.romanization).toBe('(a ha)')
    expect(bg.romanizationWords?.length).toBeGreaterThan(0)
    expect(main.isBackground).toBe(false)
    expect(main.translation).toBe('光明')
    expect(main.romanization).toBe('hi ka ri')
    expect(main.romanizationWords?.map(p => p.text)).toEqual(['hi', 'ka', 'ri'])
  })

  it('3+ 演唱者默认第 1 位左对齐、其余独唱右对齐，识别 <ttm:name>、合唱成员与单人独唱清理', () => {
    const multiTtml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata>
  <ttm:agent type="person" xml:id="v1"><ttm:name type="full">林俊杰</ttm:name></ttm:agent>
  <ttm:agent type="person" xml:id="v2"/>
  <ttm:agent type="person" xml:id="v3"><ttm:name>周杰伦</ttm:name></ttm:agent>
  <ttm:agent type="group" xml:id="v1000"/>
</metadata></head>
<body>
  <div ttm:agent="v1">
    <p begin="1.000" end="2.000"><span begin="1.000" end="2.000">第一句</span></p>
  </div>
  <div>
    <p begin="2.500" end="3.500" ttm:agent="v2"><span begin="2.500" end="3.500">第二句</span><span ttm:role="x-bg"><span begin="2.800" end="3.400">(和声)</span></span></p>
    <p begin="4.000" end="5.000" ttm:agent="v3"><span begin="4.000" end="5.000">第三句</span></p>
    <p begin="5.500" end="6.500" ttm:agent="v1 v3"><span begin="5.500" end="6.500">双人合唱</span></p>
    <p begin="7.000" end="8.000" ttm:agent="v1000"><span begin="7.000" end="8.000">全体大合唱</span></p>
  </div>
</body></tt>`
    const parsed = parseTtml(multiTtml, 'ttml-amll')!
    expect(parsed.lines.map(l => [l.agent, l.align, l.isDuet, l.isBackground])).toEqual([
      ['v1', 'left', false, false],
      ['v2', 'right', true, false],
      ['v2', 'right', true, true],
      ['v3', 'right', true, false],
      ['v1+v3', 'center', false, false],
      ['v1000', 'center', false, false],
    ])
    expect(parsed.agents?.v1).toMatchObject({ id: 'v1', name: '林俊杰', color: 'sky' })
    expect(parsed.agents?.v2).toMatchObject({ id: 'v2', color: 'rose' })
    expect(parsed.agents?.v2.name).toBeUndefined()
    expect(parsed.agents?.v3).toMatchObject({ id: 'v3', name: '周杰伦', color: 'jade' })
    expect(parsed.agents?.['v1+v3']).toMatchObject({ id: 'v1+v3', isGroup: true, members: ['v1', 'v3'] })
    expect(parsed.agents?.v1000).toMatchObject({ id: 'v1000', isGroup: true, color: 'lavender' })

    const soloTtml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata><ttm:agent type="person" xml:id="v1"><ttm:name>独唱者</ttm:name></ttm:agent></metadata></head>
<body><div><p begin="1.000" end="2.000" ttm:agent="v1"><span begin="1.000" end="2.000">只一个人唱</span></p></div></body></tt>`
    const solo = parseTtml(soloTtml, 'ttml-amll')!
    expect(solo.agents).toBeUndefined()
    expect(solo.lines[0].agent).toBeUndefined()
    expect(solo.lines[0].align).toBe('left')

    // 即使对唱歌手 v2 先开口唱引子，仍按 <head> 声明顺序保持 v1 左对齐、v2 右对齐；无 <head> 声明但正文带 ttm:agent 时同样识别
    const v2FirstTtml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata>
  <ttm:agent type="person" xml:id="v1"/>
  <ttm:agent type="person" xml:id="v2"/>
</metadata></head>
<body><div>
  <p begin="1.000" end="2.000" ttm:agent="v2"><span begin="1.000" end="2.000">引子</span></p>
  <p begin="3.000" end="4.000" ttm:agent="v1"><span begin="3.000" end="4.000">主歌</span></p>
</div></body></tt>`
    const v2First = parseTtml(v2FirstTtml, 'ttml-amll')!
    expect(v2First.lines.map(l => [l.agent, l.align, l.isDuet])).toEqual([
      ['v2', 'right', true],
      ['v1', 'left', false],
    ])
  })

  it('兼容 StarryPlayer 扩展属性（ttd:agents / ttd:position / ttv:color）与四人合唱', () => {
    const starryTtml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:ttv="urn:ttml:extensions:vocalist-style:1" xmlns:ttd="urn:ttml:extensions:display-position:1">
<head><metadata>
  <ttm:agent type="person" xml:id="v1_2" ttd:position="primary"/>
  <ttm:agent type="other" xml:id="v2_2" ttd:position="secondary"/>
  <ttm:agent type="person" xml:id="v1" ttv:color="#D9695B"><ttm:name type="full">可莉（花玲）</ttm:name></ttm:agent>
  <ttm:agent type="person" xml:id="v2" ttv:color="#3F9A66"><ttm:name type="full">温迪（喵☆酱）</ttm:name></ttm:agent>
  <ttm:agent type="person" xml:id="v4" ttv:color="#2F93A3"><ttm:name type="full">魈（kinsen）</ttm:name></ttm:agent>
  <ttm:agent type="person" xml:id="v3" ttv:color="#8462CC"><ttm:name type="full">七七（宴宁）</ttm:name></ttm:agent>
</metadata></head>
<body><div>
  <p begin="00:01.000" end="00:03.000" ttm:agent="v1_2" ttd:agents="v1"><span begin="00:01.000" end="00:03.000">可莉主歌</span></p>
  <p begin="00:04.000" end="00:06.000" ttm:agent="v2_2" ttd:agents="v2"><span begin="00:04.000" end="00:06.000">温迪右侧</span></p>
  <p begin="00:07.000" end="00:09.000" ttm:agent="v1_2" ttd:agents="v1"><span begin="00:07.000" end="00:09.000">吃饱了再去想吧</span><span ttm:role="x-bg" ttm:agent="v4"><span begin="00:08.000" end="00:09.000">(这东西能吃吗)</span></span></p>
  <p begin="00:10.000" end="00:12.000" ttm:agent="v1_2" ttd:agents="v1 v2 v4 v3"><span begin="00:10.000" end="00:12.000">烦恼都走开</span></p>
  <p begin="00:13.000" end="00:15.000" ttm:agent="v1_2" ttd:agents="v3"><span begin="00:13.000" end="00:15.000">七七左侧</span></p>
  <p begin="00:16.000" end="00:18.000" ttm:agent="v2_2" ttd:agents="v4"><span begin="00:16.000" end="00:18.000">魈右侧</span></p>
  <p begin="00:19.000" end="00:21.000" ttm:agent="v1_2" ttd:agents="v2"><span begin="00:19.000" end="00:21.000">温迪切回左侧</span></p>
</div></body></tt>`
    const parsed = parseTtml(starryTtml, 'ttml-custom')!
    expect(parsed.agents).toBeDefined()
    expect(Object.keys(parsed.agents!).sort()).toEqual(['v1', 'v1+v2+v4+v3', 'v2', 'v3', 'v4'])
    expect(parsed.agents?.v1_2).toBeUndefined()
    expect(parsed.agents?.v2_2).toBeUndefined()
    expect(parsed.agents?.v1).toMatchObject({ id: 'v1', name: '可莉（花玲）', colorHex: '#d9695b' })
    expect(parsed.agents?.v2).toMatchObject({ id: 'v2', name: '温迪（喵☆酱）', colorHex: '#3f9a66' })
    expect(parsed.agents?.v3).toMatchObject({ id: 'v3', name: '七七（宴宁）', colorHex: '#8462cc' })
    expect(parsed.agents?.v4).toMatchObject({ id: 'v4', name: '魈（kinsen）', colorHex: '#2f93a3' })
    for (const id of ['v1', 'v2', 'v3', 'v4'])
      expect(LYRIC_COLORS[parsed.agents![id].color]).toBeTruthy()
    expect(parsed.agents?.['v1+v2+v4+v3']).toMatchObject({
      id: 'v1+v2+v4+v3',
      isGroup: true,
      members: ['v1', 'v2', 'v4', 'v3'],
    })
    expect(parsed.lines.map(l => [l.agent, l.align, l.isDuet, l.isBackground])).toEqual([
      ['v1', 'left', false, false],
      ['v2', 'right', true, false],
      ['v1', 'left', false, false],
      ['v4', 'left', false, true],
      ['v1+v2+v4+v3', 'center', false, false],
      ['v3', 'left', false, false],
      ['v4', 'right', true, false],
      ['v2', 'left', false, false],
    ])
  })

  it('背景人声未标位置时默认跟随所属主唱行，显式标注位置时按标注对齐，并支持 ttd:position="duet" 与 ttv:members', () => {
    const pipaxingTtml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:ttv="urn:ttml:extensions:vocalist-style:1" xmlns:ttd="urn:ttml:extensions:display-position:1">
<head><metadata>
  <ttm:agent type="person" xml:id="v1_2" ttd:position="primary"/>
  <ttm:agent type="other" xml:id="v2_2" ttd:position="secondary"/>
  <ttm:agent type="group" xml:id="v1000_2" ttd:position="duet"/>
  <ttm:agent type="person" xml:id="v1" ttv:color="#86A2F0"><ttm:name type="full">奇然</ttm:name></ttm:agent>
  <ttm:agent type="person" xml:id="v2" ttv:color="#6CC892"><ttm:name type="full">沈谧仁</ttm:name></ttm:agent>
  <ttm:agent type="group" xml:id="g1" ttv:members="v1 v2"><ttm:name type="full">奇然 · 沈谧仁</ttm:name></ttm:agent>
</metadata></head>
<body><div>
  <p begin="00:01.000" end="00:04.000" ttm:agent="v1000_2" ttd:agents="g1">
    <span begin="00:01.000" end="00:02.000">弦转急</span>
    <span ttm:role="x-bg" ttm:agent="v1"><span begin="00:02.000" end="00:04.000">(弦转急急急急急急急)</span></span>
  </p>
  <p begin="00:05.000" end="00:08.000" ttm:agent="v1_2" ttd:agents="v1">
    <span begin="00:05.000" end="00:06.500">主唱在左</span>
    <span ttm:role="x-bg" ttd:position="secondary" ttm:agent="v2"><span begin="00:06.500" end="00:08.000">(显式标右和声)</span></span>
  </p>
  <p begin="00:09.000" end="00:12.000" ttm:agent="v1_2" ttd:agents="v1">
    <span begin="00:09.000" end="00:10.500">主唱再左</span>
    <span ttm:role="x-bg" ttm:agent="v2_2" ttd:agents="v2"><span begin="00:10.500" end="00:12.000">(载体标右和声)</span></span>
  </p>
  <p begin="00:13.000" end="00:15.000" ttm:agent="v1000_2" ttd:agents="v1"><span begin="00:13.000" end="00:15.000">独唱居中念白</span></p>
  <p begin="00:16.000" end="00:18.000" ttm:agent="v2_2" ttd:agents=""><span begin="00:16.000" end="00:18.000">未分配歌手但居右</span></p>
</div></body></tt>`
    const parsed = parseTtml(pipaxingTtml, 'ttml-custom')!
    expect(parsed.agents?.g1).toMatchObject({
      id: 'g1',
      name: '奇然 · 沈谧仁',
      isGroup: true,
      members: ['v1', 'v2'],
    })
    expect(parsed.agents?.v1_2).toBeUndefined()
    expect(parsed.agents?.v2_2).toBeUndefined()
    expect(parsed.agents?.v1000_2).toBeUndefined()
    expect(parsed.lines.map(l => [l.agent, l.align, l.isDuet, l.isBackground])).toEqual([
      ['g1', 'center', false, false],
      ['v1', 'center', false, true],
      ['v1', 'left', false, false],
      ['v2', 'right', true, true],
      ['v1', 'left', false, false],
      ['v2', 'right', true, true],
      ['v1', 'center', false, false],
      [undefined, 'right', true, false],
    ])
  })

  it('解析 starry:extensions:v1（AMLL 仓库投稿兼容模式）恢复歌手角色、颜色、摆位与共享注音', () => {
    const payload = {
      version: 1,
      agents: [
        { id: 'v1', kind: 'person', names: [{ text: '奇然', kind: 'full' }], color: { red: 134, green: 162, blue: 240 } },
        { id: 'v2', kind: 'person', names: [{ text: '沈谧仁', kind: 'full' }], color: { red: 108, green: 200, blue: 146 } },
      ],
      lines: [
        {
          key: 'L1',
          singer: 'duet',
          agentIDs: ['v1', 'v2'],
          main: {
            syllables: [
              { index: 0, groupRuby: [{ start: 1, end: 1.5, text: 'げん' }, { start: 1.5, end: 2, text: 'てん' }] },
              { index: 1, joinsRubyGroup: true },
            ],
          },
          background: { agentIDs: ['v1'], syllables: [] },
        },
        {
          key: 'L2',
          singer: 'secondary',
          agentIDs: ['v2'],
          main: { syllables: [] },
        },
      ],
    }
    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    const encoded = btoa(String.fromCharCode(...bytes))
    const repoCompatTtml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
<head><metadata>
  <ttm:agent type="person" xml:id="v1"/>
  <ttm:agent type="other" xml:id="v2"/>
  <amll:meta key="starry:extensions:v1" value="${encoded}"/>
</metadata></head>
<body><div>
  <p begin="00:01.000" end="00:04.000" ttm:agent="v1" itunes:key="L1">
    <span begin="00:01.000" end="00:01.500">弦</span><span begin="00:01.500" end="00:02.000">转</span>
    <span ttm:role="x-bg"><span begin="00:02.000" end="00:04.000">(弦转急)</span></span>
  </p>
  <p begin="00:05.000" end="00:07.000" ttm:agent="v1" itunes:key="L2">
    <span begin="00:05.000" end="00:07.000">凄凄不似向前声</span>
  </p>
</div></body></tt>`
    const parsed = parseTtml(repoCompatTtml, 'ttml-amll')!
    expect(parsed.agents?.v1).toMatchObject({ id: 'v1', name: '奇然', colorHex: '#86a2f0' })
    expect(parsed.agents?.v2).toMatchObject({ id: 'v2', name: '沈谧仁', colorHex: '#6cc892' })
    expect(parsed.lines.map(l => [l.agent, l.align, l.isDuet, l.isBackground])).toEqual([
      ['v1+v2', 'center', false, false],
      ['v1', 'center', false, true],
      ['v2', 'right', true, false],
    ])
    expect(parsed.lines[0].words[0]).toMatchObject({
      text: '弦转',
      ruby: [
        { text: 'げん', start: 1000, end: 1500 },
        { text: 'てん', start: 1500, end: 2000 },
      ],
    })
  })
})
