/**
 * 单行条（导航栏灵动岛、单曲卡）里同时在唱的几句怎么摆：
 * - 两句（焦点句 + 一句）：焦点句在上层，另一句在下层，都铺满整行（对唱行仍靠右）。下层优先放焦点句附着的背景和声，
 *   其次是离焦点句最近的另一句（重叠的对唱、上一句没唱完的和声等）
 * - 三句及以上、且两位歌手都在唱时分成四格：左列主唱、右列对唱，上排主唱句、下排背景和声，每句占一半宽度（超出时在格内横向滚动）。
 *   同一格已有句子时放到同列的另一排，两排都满时不显示；三句都是同一位歌手时仍按两句的方式摆
 */

export interface StripLine {
  // 条目下标
  index: number
  duet: boolean
  background: boolean
  // 是附着在焦点句上的背景和声
  ownedByFocus: boolean
}

export interface StripSlot {
  row: 'top' | 'bottom'
  // 四格时占一半宽度（主唱在左、对唱在右）
  half: boolean
}

// 至少这么多句同时在唱才分成四格
const GRID_MIN_LINES = 3

/** focus 为焦点句，others 为与它同时在唱的其余各句（按行号顺序）；返回各句的位置，焦点句单独在唱时为空 */
export function placeStripLines(focus: StripLine, others: StripLine[]): Map<number, StripSlot> {
  const slots = new Map<number, StripSlot>()
  if (others.length === 0)
    return slots
  const lines = [focus, ...others]
  if (lines.length >= GRID_MIN_LINES && lines.some(line => line.duet) && lines.some(line => !line.duet)) {
    const taken = new Set<string>()
    for (const line of lines) {
      const column = line.duet ? 'end' : 'start'
      const preferred: StripSlot['row'] = line.background ? 'bottom' : 'top'
      const rows: StripSlot['row'][] = preferred === 'top' ? ['top', 'bottom'] : ['bottom', 'top']
      const row = rows.find(candidate => !taken.has(`${column}-${candidate}`))
      if (!row)
        continue
      taken.add(`${column}-${row}`)
      slots.set(line.index, { row, half: true })
    }
    return slots
  }
  let pair = others.find(line => line.ownedByFocus)
  if (!pair) {
    for (const line of others) {
      if (!pair || Math.abs(line.index - focus.index) < Math.abs(pair.index - focus.index))
        pair = line
    }
  }
  slots.set(focus.index, { row: 'top', half: false })
  if (pair)
    slots.set(pair.index, { row: 'bottom', half: false })
  return slots
}
