import type { Metadata } from 'next'
import { FolderIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { getCategories } from '@/api/post'
import BlogSidebar from '@/components/blog-sidebar'
import { SectionTitle, SiteShell } from '@/components/layout/site-shell'
import { getCategoryUrl, mainPath } from '@/utils/common/route'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Public')
  return { title: t('categories'), alternates: { canonical: mainPath.category } }
}

export default async function CategoryPage() {
  const categories = await getCategories().then(res => res.data.categories).catch(() => [])
  const t = await getTranslations()

  return (
    <SiteShell
      sidebar={<BlogSidebar />}
    >
      <SectionTitle as="h1" className="mx-4 text-xl md:mx-2 md:text-2xl">
        {t('Public.categories')}
        {categories.length > 0 && <span className="ml-2 text-base font-medium text-foreground/50 tabular-nums">{categories.length}</span>}
      </SectionTitle>
      <div className="rounded-2xl bg-card p-3 md:p-4">
        {categories.length === 0
          ? <p className="py-10 text-center text-foreground/50">{t('Archive.empty')}</p>
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
                        <span className="line-clamp-2 text-sm text-foreground/50">
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
