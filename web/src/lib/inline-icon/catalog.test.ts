import { describe, expect, it } from 'vitest'
import { buildIconCatalog, iconComponentName, searchIcons } from './catalog'

const catalog = buildIconCatalog({
  version: 'test',
  categories: ['arrows', 'weather'],
  icons: [
    ['arrow-up', 'direction,north', [0]],
    ['arrow-big-up', 'direction', [0]],
    ['cloud-sun', 'weather,partly cloudy', [1]],
    ['sun', 'brightness,weather,light', [1]],
    ['sunrise', 'weather,morning', [1]],
    ['star', 'favorite,rating', []],
  ],
}, {})

const names = (query: string, labels = ['箭头 arrows', '天气 weather']) => searchIcons(catalog, query, labels).map(icon => icon.name)

describe('图标检索', () => {
  it('空关键字返回全部', () => {
    expect(names('  ')).toHaveLength(6)
  })

  it('名字完全匹配 > 前缀 > 词段前缀 > 检索词', () => {
    expect(names('sun')).toEqual(['sun', 'sunrise', 'cloud-sun'])
  })

  it('按 lucide 检索词与本地化分类名检索', () => {
    expect(names('favorite')).toEqual(['star'])
    expect(names('cloudy')).toEqual(['cloud-sun'])
    expect(names('箭头')).toEqual(['arrow-up', 'arrow-big-up'])
    // 同为分类命中时短名在前
    expect(names('天')).toEqual(['sun', 'sunrise', 'cloud-sun'])
  })

  it('多个词时每个词都要命中，空格可代替连字符', () => {
    expect(names('arrow up')).toEqual(['arrow-up', 'arrow-big-up'])
    expect(names('ARROW big')).toEqual(['arrow-big-up'])
    expect(names('sun north')).toEqual([])
  })
})

describe('组件名', () => {
  it('与 lucide 的 toPascalCase 一致', () => {
    expect(iconComponentName('a-arrow-down')).toBe('AArrowDown')
    expect(iconComponentName('arrow-down-0-1')).toBe('ArrowDown01')
    expect(iconComponentName('x')).toBe('X')
  })
})
