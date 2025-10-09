import { getTranslations } from 'next-intl/server'
import { UserProfilePage } from '@/components/console/user-profile'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('user_profile.title'),
  }
}

export default function Page() {
  return <UserProfilePage />
}
