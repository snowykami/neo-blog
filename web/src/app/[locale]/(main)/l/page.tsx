import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { getLabels } from '@/api/label'
import BlogSidebar from '@/components/blog-sidebar'
import { SectionTitle, SiteShell } from '@/components/layout/site-shell'
import { localeAlternates } from '@/i18n/alternates'
import { Link } from '@/i18n/navigation'
import { getLabelUrl, mainPath } from '@/utils/common/route'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Route')
  return { title: t('label'), alternates: localeAlternates(mainPath.label, await getLocale()) }
}

export default async function LabelPage() {
  // 取不到时抛错，不把空列表缓存成页面：错误时 Next 继续提供上一份成功生成的页面（见 api/misc.server.ts）
  const labels = await getLabels().then(res => res.data.labels ?? [])
  const t = await getTranslations()

  return (
    <SiteShell
      sidebar={<BlogSidebar />}
    >
      <SectionTitle as="h1" className="mx-4 text-xl md:mx-2 md:text-2xl">
        {t('Route.label')}
        {labels.length > 0 && <span className="ml-2 text-base font-medium text-foreground/50 tabular-nums">{labels.length}</span>}
      </SectionTitle>
      <div className="rounded-2xl bg-card p-4 md:p-6">
        {labels.length === 0
          ? <p className="py-10 text-center text-foreground/50">{t('Archive.empty')}</p>
          : (
              <div className="flex flex-wrap gap-2">
                {labels.map(label => (
                  <Link
                    key={label.id}
                    href={getLabelUrl(label)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-secondary px-3 text-sm text-secondary-foreground transition-[color,background-color,transform] duration-150 hover:bg-primary/15 hover:text-primary active:scale-[.97]"
                  >
                    {label.name}
                    {typeof label.postCount === 'number' && (
                      <span className="text-xs tabular-nums opacity-60">{label.postCount}</span>
                    )}
                  </Link>
                ))}
              </div>
            )}
      </div>
    </SiteShell>
  )
}
