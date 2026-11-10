import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getLocale, getTranslations } from 'next-intl/server'
import { getPublicConfig } from '@/api/misc'
import { getCachedSiteInfo } from '@/api/misc.server'
import { SiteShell } from '@/components/layout/site-shell'
import { localeAlternates } from '@/i18n/alternates'
import { mainPath } from '@/utils/common/route'

// 隐私政策（简版）：内容需与后端实际行为保持一致，涉及访客记录（internal/service/visit.go、visit_trust.go）、
// 错误报告（internal/service/error_report.go、src/lib/telemetry）、Cookie、评论、账号、第三方请求等改动时同步更新文案与 UPDATED_AT
const UPDATED_AT = '2026-11-06'
// 与后端配置项 visit_log_retention_days、error_report_retention_days 的默认值一致
const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_ERROR_RETENTION_DAYS = 30

// 每节依次渲染：title、body（可选）、items 列表（可选）、note（可选）
const SECTIONS: { key: string, body?: boolean, items?: readonly string[], note?: boolean }[] = [
  { key: 'browse', items: ['page', 'network', 'browser', 'engagement'], note: true },
  { key: 'errors', items: ['what', 'context', 'device', 'crash'], note: true },
  { key: 'account', items: ['profile', 'local_time', 'link', 'comment'] },
  { key: 'cookie', items: ['visitor', 'login', 'local'] },
  { key: 'retention', items: ['visit', 'visitor', 'error', 'account'] },
  { key: 'third_party', body: true },
  { key: 'choices', items: ['dnt', 'cookie', 'request'], note: true },
]

export async function generateMetadata(): Promise<Metadata> {
  const routeT = await getTranslations('Route')
  return { title: routeT('privacy_policy'), alternates: localeAlternates(mainPath.privacy, await getLocale()) }
}

// 访问记录与错误报告的保留天数来自全局配置，读取失败或非法时使用默认值
async function getRetentionDays() {
  // 取不到时抛错，不拿默认天数渲染：页面按 ISR 缓存，错误时 Next 继续提供上一份成功生成的页面（见 api/misc.server.ts）
  const config = await getPublicConfig({ visitLogRetentionDays: DEFAULT_RETENTION_DAYS, errorReportRetentionDays: DEFAULT_ERROR_RETENTION_DAYS })
    .then(res => res.data)
  const valid = (value: unknown, fallback: number) => {
    const days = Number(value)
    return Number.isInteger(days) && days > 0 ? days : fallback
  }
  return {
    days: valid(config?.visitLogRetentionDays, DEFAULT_RETENTION_DAYS),
    errorDays: valid(config?.errorReportRetentionDays, DEFAULT_ERROR_RETENTION_DAYS),
  }
}

export default async function PrivacyPage() {
  const [t, routeT, siteInfo, { days, errorDays }] = await Promise.all([
    getTranslations('Privacy'),
    getTranslations('Route'),
    getCachedSiteInfo(),
    getRetentionDays(),
  ])
  const plain = { site: siteInfo.metadata.name, owner: siteInfo.owner.name, days, errorDays, date: UPDATED_AT }
  const values = { ...plain, b: (chunks: ReactNode) => <strong>{chunks}</strong> }
  return (
    <SiteShell className="max-w-[56rem]">
      <article className="prose max-w-none rounded-2xl bg-card px-6 py-8 dark:prose-invert pangu-autospace md:px-9">
        <h1>{routeT('privacy_policy')}</h1>
        <p className="text-sm text-muted-foreground">{t('updated', plain)}</p>
        <div className="not-prose grid gap-1 rounded-xl bg-muted/60 px-5 py-4">
          <p className="font-semibold">{t('summary.title')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t.rich('summary.body', values)}</p>
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
