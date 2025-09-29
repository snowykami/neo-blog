import enData from './en.json';
import zhData from './zh.json';
import jaData from './ja.json';

export const localesData: Record<string, { name: string, data: Record<string, unknown> }> = {
  en: { name: "English", data: enData },
  zh: { name: "简体中文", data: zhData },
  'zh-tw': { name: "繁体中文 (台湾)", data: zhData },
  ja: { name: "日本語", data: jaData },
};