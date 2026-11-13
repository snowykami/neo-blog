'use client'

import type { SidebarCard } from './sidebar-cards'
import type { SidebarInitialData } from './sidebar-data'
import { parseAsString, useQueryState } from 'nuqs'
import { Suspense, useMemo } from 'react'
import { useSiteInfo } from '@/contexts/site-info-context'
import { OrderBy } from '@/models/common'
import { BlogSidebarAbout, BlogSidebarHotPosts, BlogSidebarLabels, SidebarComponentCard, SidebarIframeCard } from './blog-sidebar-card'
import { getSidebarCards } from './sidebar-cards'

interface LabelFilter {
  // 传入 setLabel 时标签云在当前页筛选，否则跳转到标签页
  label?: string | null
  setLabel?: (label: string | null) => void
  // 首页：标签云直接读写地址里的 ?label=（与首页列表同一个查询参数），在当前页筛选
  labelFromQuery?: boolean
}

// 标签云的 ?label=：与首页列表（blog-home.tsx）用同一个查询参数，读写同步
const labelParser = parseAsString

/** 读地址查询参数的标签云：放在自己的 Suspense 里，侧栏其余卡片不依赖地址，可以进页面的静态外壳 */
function QueryLabels({ initialLabels }: { initialLabels?: SidebarInitialData['labels'] }) {
  const [label, setLabel] = useQueryState('label', labelParser)
  return <BlogSidebarLabels label={label} setLabel={setLabel} initialLabels={initialLabels} />
}

function SidebarCardView({ card, label, setLabel, labelFromQuery, initialData }: { card: SidebarCard, initialData?: SidebarInitialData } & LabelFilter) {
  switch (card.type) {
    case 'about':
      return <BlogSidebarAbout />
    case 'labels':
      // 读到地址参数之前（静态外壳里）按没有选中的样子显示，同样可以点
      return labelFromQuery
        ? (
            <Suspense fallback={<BlogSidebarLabels initialLabels={initialData?.labels} />}>
              <QueryLabels initialLabels={initialData?.labels} />
            </Suspense>
          )
        : <BlogSidebarLabels label={label} setLabel={setLabel} initialLabels={initialData?.labels} />
    case 'hot_posts':
      return <BlogSidebarHotPosts posts={initialData?.hotPosts} orderType={OrderBy.Heat} />
    case 'latest_posts':
      return <BlogSidebarHotPosts posts={initialData?.latestPosts} orderType={OrderBy.CreatedAt} />
    case 'iframe':
      return <SidebarIframeCard title={card.title} url={card.url} height={card.height} />
    case 'component':
      return <SidebarComponentCard title={card.title} name={card.name} props={card.props} version={card.version} />
  }
}

/**
 * 文章列表页侧边栏：按后台「侧边栏卡片」配置的顺序渲染
 * exclude：本页正文已经展示了同样内容时隐藏对应卡片（如标签页不再显示标签云）
 */
export default function BlogSidebar({ label, setLabel, labelFromQuery, exclude, initialData }: LabelFilter & { exclude?: SidebarCard['type'][], initialData?: SidebarInitialData }) {
  const { siteInfo } = useSiteInfo()
  const cards = useMemo(
    () => getSidebarCards(siteInfo).filter(card => !exclude?.includes(card.type)),
    [siteInfo, exclude],
  )
  return (
    <div className="grid gap-4">
      {/* 卡片可能因未配置 / 无内容而不渲染，空容器隐藏以免留下多余间距；配置项没有稳定 ID，以类型与位置作为 key */}
      {cards.map((card, idx) => (
        <div key={`${card.type}-${idx}`} className="empty:hidden">
          <SidebarCardView card={card} label={label} setLabel={setLabel} labelFromQuery={labelFromQuery} initialData={initialData} />
        </div>
      ))}
    </div>
  )
}
