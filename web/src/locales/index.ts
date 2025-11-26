import deData from './de.json'
import enData from './en.json'
import esData from './es.json'
import frData from './fr.json'
import hiData from './hi.json'
import jaData from './ja.json'
import koData from './ko.json'
import ptData from './pt.json'
import ruData from './ru.json'
import zhTwData from './zh-tw.json'
import zhWyData from './zh-wy.json'
import zhData from './zh.json'

export const localesData: Record<string, { name: string, data: Record<string, unknown> }> = {
  'de': { name: 'Deutsch', data: deData },
  'en': { name: 'English', data: enData },
  'es': { name: 'Español', data: esData },
  'fr': { name: 'Français', data: frData },
  'hi': { name: 'हिन्दी', data: hiData },
  'ja': { name: '日本語', data: jaData },
  'ko': { name: '한국어', data: koData },
  'pt': { name: 'Português', data: ptData },
  'ru': { name: 'Русский', data: ruData },
  'zh': { name: '简体中文', data: zhData },
  'zh-tw': { name: '繁體中文(中國台灣)', data: zhTwData },
  'zh-wy': { name: '華夏言', data: zhWyData },
}
