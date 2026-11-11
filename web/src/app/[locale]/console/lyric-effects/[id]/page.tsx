import { getTranslations } from 'next-intl/server'
import { LyricEffectEditor } from '@/components/console/lyric-effects/lyric-effect-editor'

// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）
export const instant = false

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('lyric_effects.editor_title'),
  }
}

export default function Page() {
  return <LyricEffectEditor />
}
