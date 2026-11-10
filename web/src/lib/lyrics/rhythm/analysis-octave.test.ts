import type { TempoCase } from './tempo-fixtures'
import { describe, expect, it } from 'vitest'
import { analyzeRhythm } from './analysis'
import { FIXTURE_RATE, tempoRegressionSet } from './tempo-fixtures'

/**
 * 拍速八度回归集（合成音轨，见 tempo-fixtures.ts）：真值为谱面四分音符。
 * 判对 = 与真值相差 4% 以内；判错只允许差整一个八度（两倍或一半），不允许落到三连音之类的其他比例。
 *
 * 已知判错的用例：梳状和对偏慢的候选没有区分力（它的谐波全在真拍的整数倍上），八度由 120 BPM 附近的
 * 先验决定，于是 ≤ 84 BPM 的抒情曲判成两倍、> 150 BPM 的快歌判成一半。放宽先验能救回一部分慢歌，
 * 但常速鼓型会成批判成一半（中心 0.5 秒、σ 1.4 个八度时慢歌 3/10、常速从 33/41 掉到 28/41），总数只降不升，
 * 所以先验维持原样。这里锁住"已知判错的只能变少"：改进可以直接通过，退化会失败
 */
const KNOWN_OCTAVE_ERRORS = new Set([
  'ballad@50',
  'ballad@54 [dropout+vocal]',
  'ballad@58 [noise+vocal]',
  'ballad@62 [jitter+vocal]',
  'ballad@66',
  'ballad@72 [dropout+vocal]',
  'ballad16@50 [jitter+vocal]',
  'ballad16@54',
  'ballad16@58 [dropout+vocal]',
  'ballad16@62 [noise+vocal]',
  'ballad16@66 [jitter+vocal]',
  'piano_ballad@52',
  'piano_ballad@60 [dropout+vocal]',
  'piano_ballad@68 [noise+vocal]',
  'piano_ballad@76 [jitter+vocal]',
  'piano_ballad@84',
  'pop@66 [dropout+vocal]',
  'pop@160 [dropout+vocal]',
  'half_time@150 [noise+vocal]',
  'half_time@160 [jitter+vocal]',
  'half_time@170',
  'half_time@180 [dropout+vocal]',
  'fast@165',
  'fast@172 [dropout+vocal]',
  'fast@180 [noise+vocal]',
])

interface Outcome {
  item: TempoCase
  bpm: number
  octave: number // 0 = 判对，+1 = 判成两倍，−1 = 判成一半
  exact: boolean // 与 真值 × 2^octave 相差 4% 以内
}

const outcomes: Outcome[] = tempoRegressionSet().map((item) => {
  const { bpm } = analyzeRhythm(item.render(), FIXTURE_RATE)
  const octave = Math.round(Math.log2(bpm / item.bpm)) || 0
  return { item, bpm, octave, exact: Math.abs(bpm / (item.bpm * 2 ** octave) - 1) < 0.04 }
})

const describeOutcome = (o: Outcome) => `${o.item.id} → ${o.bpm.toFixed(1)} BPM`

describe('拍速八度回归集', () => {
  it('自相关覆盖最长候选（1.5 秒）的 4 次谐波，梳状和对每个候选都取满 4 项', () => {
    const analysis = analyzeRhythm(tempoRegressionSet()[0].render(), FIXTURE_RATE)
    expect((analysis.autocorr.length - 2) * analysis.frameMs).toBeGreaterThanOrEqual(6000)
  })

  it('判错只差整一个八度，拍长本身是准的', () => {
    for (const o of outcomes) {
      expect(o.exact, describeOutcome(o)).toBe(true)
      expect(Math.abs(o.octave), describeOutcome(o)).toBeLessThanOrEqual(1)
    }
  })

  it('有鼓、军鼓在 2、4 拍的常速曲（80 ~ 150 BPM）全部判对八度', () => {
    const drums = outcomes.filter(o => o.item.bpm >= 80 && o.item.bpm <= 150 && !['piano_ballad', 'half_time'].includes(o.item.style))
    expect(drums.length).toBeGreaterThan(25)
    for (const o of drums)
      expect(o.octave, describeOutcome(o)).toBe(0)
  })

  it('已知判错的用例只能变少（慢歌判成两倍、快歌判成一半）', () => {
    const failures = outcomes.filter(o => o.octave !== 0)
    for (const o of failures) {
      expect(KNOWN_OCTAVE_ERRORS.has(o.item.id), `新增判错：${describeOutcome(o)}`).toBe(true)
      // 慢的只会判快、快的只会判慢，方向反了说明先验或梳状和出了别的问题
      expect(o.octave, describeOutcome(o)).toBe(o.item.bpm < 100 ? 1 : -1)
    }
    const correct = outcomes.length - failures.length
    expect(correct / outcomes.length).toBeGreaterThanOrEqual(34 / 59)
  })
})
