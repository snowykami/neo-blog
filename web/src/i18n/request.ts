import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import deepmerge from 'deepmerge';
import { getLoginUser } from '@/api/user';

export default getRequestConfig(async () => {
  const locales = await getUserLocales();
  const messages = await Promise.all(
    locales.map(async (locale) => {
      try {
        return (await import(`@/locales/${locale}.json`)).default;
      } catch (err) {
        console.error(err)
        return {};
      }
    })
  ).then((msgs) => msgs.reduce((acc, msg) => deepmerge(acc, msg), {}));
  return {
    locale: locales[0],
    messages
  };
});

export async function getUserLocales(): Promise<string[]> {
  let locales: string[] = ["zh-CN", "zh", "en-US", "en"];
  const headersList = await headers();
  const cookieStore = await cookies();
  try {
    const token = cookieStore.get('token')?.value || '';
    const user = (await getLoginUser(token)).data;
    locales.push(user.language);
    locales.push(user.language.split('-')[0]);
  } catch (error) {
    console.info("获取用户信息失败，使用默认语言", error);
  }
  const languageInCookie = cookieStore.get('language')?.value;
  if (languageInCookie) {
    locales.push(languageInCookie);
    locales.push(languageInCookie.split('-')[0]);
  }
  const acceptLanguage = headersList.get('accept-language');
  if (acceptLanguage) {
    const languages = acceptLanguage.split(',').map(lang => lang.split(';')[0]);
    const languagesWithoutRegion = languages.map(lang => lang.split('-')[0]);
    locales = [...new Set([...locales, ...languages, ...languagesWithoutRegion])];
  }
  return locales.reverse();
}