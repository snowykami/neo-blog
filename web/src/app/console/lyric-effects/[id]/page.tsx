import { getTranslations } from 'next-intl/server'
import { LyricEffectEditor } from '@/components/console/lyric-effects/lyric-effect-editor'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('lyric_effects.editor_title'),
  }
}

export default function Page() {
  return <LyricEffectEditor />
}
