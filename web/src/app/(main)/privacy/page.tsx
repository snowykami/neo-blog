import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { getPublicConfig } from '@/api/misc'
import { getCachedSiteInfo } from '@/api/misc.server'
import { SiteShell } from '@/components/layout/site-shell'

// 隐私政策：内容需与后端实际行为保持一致，涉及访客记录（internal/service/visit.go）、
// Cookie、评论、账号、第三方请求等改动时同步更新文案与 UPDATED_AT
const UPDATED_AT = '2026-10-25'
// 与后端 internal/tasks/visit_log_cleanup.go 的默认值一致
const DEFAULT_RETENTION_DAYS = 90

// 每节依次渲染：title、body（可选）、items 列表（可选）、note（可选）
const SECTIONS: { key: string, body?: boolean, items?: readonly string[], note?: boolean }[] = [
  { key: 'browse', body: true, items: ['page', 'network', 'device', 'feature', 'account'], note: true },
  { key: 'account', body: true, items: ['profile', 'oidc', 'login', 'ip_location'] },
  { key: 'interact', body: true, items: ['comment', 'client_info', 'like'] },
  { key: 'dnt', body: true },
  { key: 'cookie', body: true, items: ['visitor', 'login', 'oidc', 'local'], note: true },
  { key: 'third_party', body: true, items: ['ip_lookup', 'weather', 'captcha', 'oidc', 'gravatar', 'email', 'resources', 'embed'], note: true },
  { key: 'use', items: ['stats', 'service', 'security'], note: true },
  { key: 'retention', items: ['visit', 'visitor', 'account', 'session'] },
  { key: 'rights', body: true, items: ['self', 'content', 'limit', 'request'], note: true },
  { key: 'security', body: true },
  { key: 'children', body: true },
  { key: 'changes', body: true },
  { key: 'contact', body: true },
]

const SUMMARY_ITEMS = ['no_sale', 'stats', 'dnt', 'comment', 'rights'] as const

export async function generateMetadata(): Promise<Metadata> {
  const routeT = await getTranslations('Route')
  return { title: routeT('privacy_policy') }
}

// 访问记录保留天数来自全局配置，读取失败或非法时使用默认值
async function getRetentionDays() {
  const days = await getPublicConfig({ visitLogRetentionDays: DEFAULT_RETENTION_DAYS })
    .then(res => Number(res.data.visitLogRetentionDays))
    .catch(() => DEFAULT_RETENTION_DAYS)
  return Number.isInteger(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS
}

export default async function PrivacyPage() {
  const [t, routeT, siteInfo, days] = await Promise.all([
    getTranslations('Privacy'),
    getTranslations('Route'),
    getCachedSiteInfo(),
    getRetentionDays(),
  ])
  const plain = { site: siteInfo.metadata.name, owner: siteInfo.owner.name, days, date: UPDATED_AT }
  const values = { ...plain, b: (chunks: ReactNode) => <strong>{chunks}</strong> }
  return (
    <SiteShell className="max-w-[56rem]">
      <article className="prose max-w-none rounded-2xl bg-card px-6 py-8 dark:prose-invert pangu-autospace md:px-9">
        <h1>{routeT('privacy_policy')}</h1>
        <p className="text-sm text-muted-foreground">{t('updated', plain)}</p>
        <p>{t.rich('intro', values)}</p>
        <div className="not-prose grid gap-2 rounded-xl bg-muted/60 px-5 py-4">
          <p className="font-semibold">{t('summary.title')}</p>
          <ul className="grid list-disc gap-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary">
            {SUMMARY_ITEMS.map(item => <li key={item}>{t.rich(`summary.items.${item}`, values)}</li>)}
          </ul>
        </div>
        {SECTIONS.map((section, index) => (
          <section key={section.key}>
            <h2>{`${index + 1}. ${t(`${section.key}.title`)}`}</h2>
            {section.body && <p>{t.rich(`${section.key}.body`, values)}</p>}
            {section.items && (
              <ul>
                {section.items.map(item => <li key={item}>{t.rich(`${section.key}.items.${item}`, values)}</li>)}
              </ul>
            )}
            {section.note && <p>{t.rich(`${section.key}.note`, values)}</p>}
          </section>
        ))}
      </article>
    </SiteShell>
  )
}
