import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getUserByUsername } from '@/api/user'
import { formatDisplayName } from '@/utils/common/username'
import { UserPage } from './user'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}): Promise<Metadata> {
  const { username } = await params
  const user = await getUserByUsername(username)
    .then(r => r.data)
    .catch(() => null)
  if (user)
    return { title: formatDisplayName(user) }
  const t = await getTranslations('UserPage')
  return { title: t('user_not_found') }
}

export default function Page() {
  return (
    <div>
      <UserPage />
    </div>
  )
}
