import type { Dashboard } from '@/models/dashboard'
import type { IconType } from '@/types/icon'
import { Eye, Folder, MessageCircle, Newspaper, NotebookText, Users } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { consolePath } from '@/utils/common/route'

// 站点累计：不随统计区间变化，作为背景信息放在靠后的位置
export function TotalsCard({ data }: { data: Dashboard }) {
  const t = useTranslations('Console.dashboard')
  const format = useFormatter()
  const items: { key: string, icon: IconType, value: number, url: string, hint?: string }[] = [
    {
      key: 'total_posts',
      icon: Newspaper,
      value: data.totalPosts,
      url: consolePath.post,
      hint: t('total_posts_hint', { public: data.content.publicPosts, private: data.content.privatePosts }),
    },
    { key: 'total_pages', icon: NotebookText, value: data.content.pages, url: consolePath.page },
    { key: 'total_views', icon: Eye, value: data.totalViews, url: consolePath.visit },
    { key: 'total_comments', icon: MessageCircle, value: data.totalComments, url: consolePath.comment },
    {
      key: 'total_users',
      icon: Users,
      value: data.totalUsers,
      url: consolePath.user,
      hint: t('new_users_hint', { count: data.summary.newUsers.current, days: data.days }),
    },
    { key: 'total_files', icon: Folder, value: data.totalFiles, url: consolePath.file },
  ]
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t('totals_title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-1 px-2 sm:grid-cols-3 xl:grid-cols-6">
        {items.map(item => (
          <Link key={item.key} href={item.url} className="grid content-start gap-1 rounded-md px-2 py-2 transition-colors hover:bg-accent">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <item.icon className="size-3.5" aria-hidden="true" />
              {t(item.key)}
            </span>
            <span className="text-xl font-semibold tabular-nums">{format.number(item.value)}</span>
            {item.hint && <span className="truncate text-xs text-muted-foreground">{item.hint}</span>}
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
