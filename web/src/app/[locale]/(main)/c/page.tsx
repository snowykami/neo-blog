import type { Metadata } from 'next'
import { FolderIcon } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import BlogSidebar from '@/components/blog-sidebar'
import { SectionTitle, SiteShell } from '@/components/layout/site-shell'
import { localeAlternates } from '@/i18n/alternates'
import { Link } from '@/i18n/navigation'
import { getCategoryUrl, mainPath } from '@/utils/common/route'
import { getCachedCategories } from './[slug]/category-data'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Public')
  return { title: t('categories'), alternates: localeAlternates(mainPath.category, await getLocale()) }
}

export default async function CategoryPage() {
  // 分类列表跨请求缓存（与分类页共用）；取不到时抛错，不把空列表缓存成页面：错误时 Next 继续提供上一份成功生成的页面（见 api/misc.server.ts）
  const categories = await getCachedCategories()
  const t = await getTranslations()

  return (
    <SiteShell
      sidebar={<BlogSidebar />}
    >
      <SectionTitle as="h1" className="mx-4 text-xl md:mx-2 md:text-2xl">
        {t('Public.categories')}
        {categories.length > 0 && <span className="ml-2 text-base font-medium text-muted-foreground tabular-nums">{categories.length}</span>}
      </SectionTitle>
      <div className="rounded-2xl bg-card p-3 md:p-4">
        {categories.length === 0
          ? <p className="py-10 text-center text-muted-foreground">{t('Archive.empty')}</p>
          : (
              <ul className="grid gap-1 md:grid-cols-2">
                {categories.map(category => (
                  <li key={category.id}>
                    {/* 行悬停时浅主色底、标题右移 */}
                    <Link
                      href={getCategoryUrl(category)}
                      className="group flex items-start gap-3 rounded-xl p-3 transition-colors duration-150 hover:bg-primary/10"
                    >
                      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                        <FolderIcon className="size-4.5" />
                      </span>
                      <span className="grid min-w-0 gap-0.5">
                        <span className="truncate font-bold text-foreground/90 transition-[color,transform] duration-150 group-hover:translate-x-1 group-hover:text-primary">
                          {category.name}
                        </span>
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {category.description || category.slug}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
      </div>
    </SiteShell>
  )
}
