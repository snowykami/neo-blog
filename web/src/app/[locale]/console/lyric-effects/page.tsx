import { getTranslations } from 'next-intl/server'
import { LyricEffectManage } from './lyric-effect-manage'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('lyric_effects.title'),
  }
}

export default function Page() {
  return <LyricEffectManage />
}
