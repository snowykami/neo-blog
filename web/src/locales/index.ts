import enData from './en.json'
import jaData from './ja.json'
import zhTwData from './zh-tw.json'
import zhWyData from './zh-wy.json'
import zhData from './zh.json'

export const localesData: Record<string, { name: string, data: Record<string, unknown> }> = {
  'en': { name: 'English', data: enData },
  'zh': { name: '简体中文', data: zhData },
  'zh-tw': { name: '繁体中文 (台湾)', data: zhTwData },
  'zh-wy': { name: '文言', data: zhWyData },
  'ja': { name: '日本語', data: jaData },
}
