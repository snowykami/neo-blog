import enData from './en.json'
import jaData from './ja.json'
import koData from './ko.json'
import zhTwData from './zh-tw.json'
import zhData from './zh.json'

// 界面语言只保留简中、繁中、日语、English、한국어；其他语言回退到 en
export const localesData: Record<string, { name: string, data: Record<string, unknown> }> = {
  'en': { name: 'English', data: enData },
  'ja': { name: '日本語', data: jaData },
  'ko': { name: '한국어', data: koData },
  'zh': { name: '简体中文', data: zhData },
  'zh-tw': { name: '繁體中文(中國台灣)', data: zhTwData },
}
