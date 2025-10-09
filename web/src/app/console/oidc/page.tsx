import { getTranslations } from 'next-intl/server'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('oidc.title'),
  }
}

export default function Page() {
  return (<div><h1>认证管理</h1></div>)
}
