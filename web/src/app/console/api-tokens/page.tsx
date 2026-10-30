import { getTranslations } from 'next-intl/server'
import { APITokenManage } from './api-token-manage'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('api_tokens.title'),
  }
}

export default function Page() {
  return <APITokenManage />
}
