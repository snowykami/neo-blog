import { getTranslations } from 'next-intl/server'
import { UserManagePage } from './users-page'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('users.title'),
  }
}

export default function Page() {
  return (
    <UserManagePage />
  )
}
