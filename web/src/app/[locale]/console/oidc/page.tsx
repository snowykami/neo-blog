import { getTranslations } from 'next-intl/server'
import OidcManage from './oidc-manage'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('oidc.title'),
  }
}

export default function Page() {
  return <OidcManage />
}
