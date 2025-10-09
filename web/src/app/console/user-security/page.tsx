import { getTranslations } from 'next-intl/server'
import { UserSecurityPage } from '@/components/console/user-security'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('user_security.title'),
  }
}

export default function Page() {
  return <UserSecurityPage />
}
