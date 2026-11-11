import { getTranslations } from 'next-intl/server'
import { AIUsageCard } from '@/components/console/dashboard/ai-usage-card'
import { RuntimeCard } from '@/components/console/dashboard/runtime-card'

// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）
export const instant = false

export async function generateMetadata() {
  const t = await getTranslations('Console.dashboard')
  return { title: t('runtime_title') }
}

export default function Page() {
  return (
    <div className="grid gap-4">
      <RuntimeCard />
      <AIUsageCard />
    </div>
  )
}
