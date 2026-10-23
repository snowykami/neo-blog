'use client'

import type { SidebarCard } from './sidebar-cards'
import { useMemo } from 'react'
import { useSiteInfo } from '@/contexts/site-info-context'
import { OrderBy } from '@/models/common'
import { BlogSidebarAbout, BlogSidebarHotPosts, BlogSidebarLabels, SidebarComponentCard, SidebarIframeCard } from './blog-sidebar-card'
import { getSidebarCards } from './sidebar-cards'

interface LabelFilter {
  // 传入 setLabel 时标签云在当前页筛选，否则跳转到标签页
  label?: string | null
  setLabel?: (label: string | null) => void
}

function SidebarCardView({ card, label, setLabel }: { card: SidebarCard } & LabelFilter) {
  switch (card.type) {
    case 'about':
      return <BlogSidebarAbout />
    case 'labels':
      return <BlogSidebarLabels label={label} setLabel={setLabel} />
    case 'hot_posts':
      return <BlogSidebarHotPosts orderType={OrderBy.Heat} />
    case 'latest_posts':
      return <BlogSidebarHotPosts orderType={OrderBy.CreatedAt} />
    case 'iframe':
      return <SidebarIframeCard title={card.title} url={card.url} height={card.height} />
    case 'component':
      return <SidebarComponentCard title={card.title} name={card.name} props={card.props} version={card.version} />
  }
}

/** 文章列表页侧边栏：按后台「侧边栏卡片」配置的顺序渲染 */
export default function BlogSidebar({ label, setLabel }: LabelFilter) {
  const { siteInfo } = useSiteInfo()
  const cards = useMemo(() => getSidebarCards(siteInfo), [siteInfo])
  return (
    <div className="grid gap-4">
      {/* 卡片可能因未配置 / 无内容而不渲染，空容器隐藏以免留下多余间距；配置项没有稳定 ID，以类型与位置作为 key */}
      {cards.map((card, idx) => (
        <div key={`${card.type}-${idx}`} className="empty:hidden">
          <SidebarCardView card={card} label={label} setLabel={setLabel} />
        </div>
      ))}
    </div>
  )
}
