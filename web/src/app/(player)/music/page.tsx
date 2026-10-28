import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { MusicPlayerPage } from '@/components/music-page/music-player-page'

// 播放器页：沉浸式全屏，不使用站点顶栏与页脚（不在 (main) 路由组内）；播放状态来自根布局的全局 MusicProvider
export async function generateMetadata(): Promise<Metadata> {
  const routeT = await getTranslations('Route')
  return { title: routeT('music') }
}

export default function MusicPage() {
  return <MusicPlayerPage />
}
