import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import deepmerge from 'deepmerge';
import { getLoginUserServer } from '@/api/user.server';

export default getRequestConfig(async () => {
  const locales = await getUserLocales();
  const messages = await Promise.all(
    locales.reverse().map(async (locale) => {
      try {
        return (await import(`@/locales/${locale}.json`)).default;
      } catch {
        return {};
      }
    })
  ).then((msgs) => msgs.reduce((acc, msg) => deepmerge(acc, msg), {}));
  return {
    locale: locales[0],
    messages
  };
});

// 用户语言偏好获取逻辑
// 优先级：用户设置 > 浏览器语言，优先级从高到低排列
export async function getUserLocales(): Promise<string[]> {
  let locales: string[] = [];

  try {
    const user = (await getLoginUserServer()).data;
    locales.push(user?.language || '');
    locales.push((user?.language || '').split('-')[0]);
  } catch { }

  const headersList = await headers();
  const acceptLanguage = headersList.get('accept-language');
  if (acceptLanguage) {
    const languages = acceptLanguage.split(',').map(lang => lang.split(';')[0]);
    const languagesWithoutRegion = languages.map(lang => lang.split('-')[0]);
    locales = locales.concat(languages).concat(languagesWithoutRegion);
  }

  // 有序去重、去空并归一化（小写）
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of locales) {
    const v = (raw || '').trim().toLowerCase();
    if (!v) continue;
    if (!seen.has(v)) {
      seen.add(v);
      unique.push(v);
    }
  }

  // 保证至少返回一个默认语言
  if (unique.length === 0) unique.push('en');
  return unique;
}

export async function getFirstLocale(): Promise<string> {
  const locales = await getUserLocales();
  return locales[0];
}