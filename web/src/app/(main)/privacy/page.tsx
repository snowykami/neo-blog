import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { SiteShell } from '@/components/layout/site-shell'

// 隐私政策：内容需与访客记录（internal/service/visit.go）实际收集的信息保持一致
const SECTIONS = ['collect', 'cookie', 'purpose', 'retention', 'dnt', 'contact'] as const

export async function generateMetadata(): Promise<Metadata> {
  const routeT = await getTranslations('Route')
  return { title: routeT('privacy_policy') }
}

export default async function PrivacyPage() {
  const t = await getTranslations('Privacy')
  const routeT = await getTranslations('Route')
  return (
    <SiteShell className="max-w-[56rem]">
      <article className="prose max-w-none rounded-2xl bg-card px-6 py-8 dark:prose-invert pangu-autospace md:px-9">
        <h1>{routeT('privacy_policy')}</h1>
        <p className="text-sm text-muted-foreground">{t('updated', { date: '2026-10-22' })}</p>
        <p>{t('intro')}</p>
        {SECTIONS.map(section => (
          <section key={section}>
            <h2>{t(`${section}_title`)}</h2>
            <p>{t(`${section}_body`)}</p>
          </section>
        ))}
      </article>
    </SiteShell>
  )
}
