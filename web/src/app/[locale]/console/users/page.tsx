import { getTranslations } from 'next-intl/server'
import { UserManagePage } from './users-page'

// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）
export const instant = false

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
