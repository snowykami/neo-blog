import { getTranslations } from 'next-intl/server'
import { LyricEffectManage } from './lyric-effect-manage'

// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）
export const instant = false

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('lyric_effects.title'),
  }
}

export default function Page() {
  return <LyricEffectManage />
}
