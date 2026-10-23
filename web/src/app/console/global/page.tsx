import { getTranslations } from 'next-intl/server'
import { AdvancedKvEditor } from './advanced-kv'
import { SettingsForm } from './settings-form'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('global.title'),
  }
}

export default function Page() {
  return <SettingsForm advanced={<AdvancedKvEditor />} />
}
