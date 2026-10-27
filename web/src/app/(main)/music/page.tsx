import type { Metadata } from 'next'
import { MusicIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { SiteShell } from '@/components/layout/site-shell'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

// 音乐页：目前只是路由空壳，完整的播放器（歌单、歌词、播放控制）后续单独实现
export async function generateMetadata(): Promise<Metadata> {
  const routeT = await getTranslations('Route')
  return { title: routeT('music') }
}

export default async function MusicPage() {
  const [t, routeT] = await Promise.all([
    getTranslations('MusicPage'),
    getTranslations('Route'),
  ])
  return (
    <SiteShell>
      <div className="grid gap-4">
        <h1 className="text-2xl font-bold">{routeT('music')}</h1>
        <Empty className="bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MusicIcon />
            </EmptyMedia>
            <EmptyTitle>{t('placeholder_title')}</EmptyTitle>
            <EmptyDescription>{t('placeholder_description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </SiteShell>
  )
}
