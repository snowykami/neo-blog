'use client'
import type { Label } from '@/models/label'
import type { Post } from '@/models/post'
import { ChevronDownIcon, ChevronUpIcon, Eye, Heart } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getLabels } from '@/api/label'
import { listPosts } from '@/api/post'
import { ImageAvatar } from '@/components/common/avatar'
import { SafeImage } from '@/components/common/safe-image'
import { Button } from '@/components/ui/button'
import { useSiteInfo } from '@/contexts/site-info-context'
import { cn } from '@/lib/utils'
import { OrderBy } from '@/models/common'
import { getGravatarUrl } from '@/utils/common/gravatar'
import { getLabelUrl, getPostUrl } from '@/utils/common/route'
import { getFallbackAvatarFromUsername } from '@/utils/common/username'
import { SidebarCard } from './sidebar-card'

// 关于我卡片（参考 Fuwari 的 Profile，MIT License, saicaca/fuwari）：
// 无背景图时头像铺满卡片宽度；配置了背景图时背景图作为横幅，头像压在横幅下沿
export function BlogSidebarAbout() {
  const { siteInfo } = useSiteInfo()
  if (!siteInfo)
    return null
  const { owner, aboutBackground } = siteInfo
  // 优先使用站长头像，其次 Gravatar 邮箱；都没有时显示名称首字
  const avatarSrc = owner?.avatar || (owner?.gravatarEmail ? getGravatarUrl({ email: owner.gravatarEmail, size: 512 }) : undefined)
  const name = owner?.name || siteInfo.metadata.name
  return (
    <SidebarCard className="p-3">
      {aboutBackground
        ? (
            <div className="mb-3">
              <div className="relative aspect-[2/1] w-full overflow-hidden rounded-xl bg-muted">
                <SafeImage src={aboutBackground} alt="" fill sizes="280px" className="object-cover" />
              </div>
              <ImageAvatar
                src={avatarSrc}
                alt={name}
                fallback={getFallbackAvatarFromUsername(name)}
                className="relative mx-auto -mt-10 size-20 ring-4 ring-card"
                fallbackClassName="bg-secondary text-2xl font-bold text-secondary-foreground"
              />
            </div>
          )
        : (
            <ImageAvatar
              src={avatarSrc}
              alt={name}
              fallback={getFallbackAvatarFromUsername(name)}
              className="mx-auto mb-3 aspect-square size-auto w-full max-w-48 rounded-xl lg:max-w-none"
              fallbackClassName="bg-secondary text-5xl font-bold text-secondary-foreground"
            />
          )}
      <div className="px-2 pb-1 text-center">
        <div className="mb-1 text-xl font-bold text-foreground/90">{name}</div>
        <div aria-hidden className="mx-auto mb-2 h-1 w-5 rounded-full bg-primary" />
        {owner?.motto && <p className="mb-1 text-foreground/75">{owner.motto}</p>}
        {owner?.description && <p className="text-sm text-foreground/50">{owner.description}</p>}
      </div>
    </SidebarCard>
  )
}

// 热门 / 最新文章卡片：orderType 决定获取顺序与标题
export function BlogSidebarHotPosts({ posts: initialPosts, orderType = OrderBy.Heat }: { posts?: Post[], orderType?: OrderBy.Heat | OrderBy.CreatedAt }) {
  const blogHomeT = useTranslations('BlogHome')
  const metricsT = useTranslations('Metrics')
  const [posts, setPosts] = useState<Post[]>(initialPosts ?? [])
  const isLatest = orderType === OrderBy.CreatedAt
  useEffect(() => {
    // 未传入文章时从服务器获取
    if (initialPosts && initialPosts.length > 0)
      return
    let cancelled = false
    listPosts({ orderBy: orderType, page: 1, size: 5, noContent: true })
      .then((res) => {
        if (!cancelled)
          setPosts(res.data.posts || [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [initialPosts, orderType])
  if (posts.length === 0)
    return null
  return (
    <SidebarCard title={isLatest ? blogHomeT('latest_posts') : blogHomeT('hottest_posts')}>
      <ol className="-mx-2 grid gap-0.5">
        {posts.slice(0, 5).map((post, index) => (
          <li key={post.id}>
            <Link
              href={getPostUrl({ post })}
              className="group flex items-start gap-3 rounded-lg p-2 transition-colors duration-150 hover:bg-primary/10"
            >
              <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-sm font-bold text-secondary-foreground tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium text-foreground/75 transition-colors duration-150 group-hover:text-primary">{post.title}</div>
                <div className="mt-1 flex items-center gap-3 text-xs text-foreground/30 tabular-nums">
                  <span className="flex items-center gap-1">
                    <Eye aria-hidden className="size-3" />
                    <span className="sr-only">{metricsT('view_count')}</span>
                    {post.viewCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart aria-hidden className="size-3" />
                    <span className="sr-only">{metricsT('like_count')}</span>
                    {post.likeCount}
                  </span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </SidebarCard>
  )
}

// 标签云折叠前显示的数量
const LABELS_COLLAPSED_COUNT = 20

// 标签云卡片：传入 setLabel 时在当前页筛选，否则跳转到标签对应的列表
export function BlogSidebarLabels({
  label = null,
  setLabel,
}: {
  label?: string | null
  setLabel?: (label: string | null) => void
}) {
  const t = useTranslations('Common')
  const [labels, setLabels] = useState<Label[]>([])
  const [expanded, setExpanded] = useState(false)
  const router = useRouter()
  useEffect(() => {
    getLabels()
      .then((res) => {
        setLabels((res.data.labels || []).filter(l => (l.postCount ?? 0) > 0))
      })
      .catch(() => {})
  }, [])

  if (labels.length === 0)
    return null

  const onClickLabel = (l: Label) => {
    if (setLabel) {
      setLabel(label === l.slug ? null : l.slug)
    }
    else {
      router.push(getLabelUrl(l))
    }
  }

  const collapsible = labels.length > LABELS_COLLAPSED_COUNT
  // 折叠时仍保留当前选中的标签，避免选中项被隐藏
  const visibleLabels = !collapsible || expanded
    ? labels
    : labels.filter((l, index) => index < LABELS_COLLAPSED_COUNT || l.slug === label)

  return (
    <SidebarCard title={t('labels_cloud')}>
      <div className="flex flex-wrap gap-2">
        {visibleLabels.map((l) => {
          const selected = label === l.slug
          return (
            <button
              key={l.id}
              type="button"
              aria-pressed={setLabel ? selected : undefined}
              onClick={() => onClickLabel(l)}
              className={cn(
                'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm transition-[color,background-color,transform] duration-150 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-primary/15 hover:text-primary',
              )}
            >
              {l.name}
              <span className="text-xs tabular-nums opacity-60">{(l.postCount ?? 0) > 99 ? '99+' : l.postCount}</span>
            </button>
          )
        })}
      </div>
      {collapsible && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-foreground/50 hover:text-primary"
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? <ChevronUpIcon aria-hidden /> : <ChevronDownIcon aria-hidden />}
          {expanded ? t('show_less') : t('show_more')}
        </Button>
      )}
    </SidebarCard>
  )
}

// 侧边栏嵌入页面（默认为 Misskey 时间线），地址留空时不显示
// 只在客户端渲染 iframe，避免 hydration 报错
export function SidebarMisskeyIframe() {
  const { siteInfo } = useSiteInfo()
  const [show, setShow] = useState(false)
  useEffect(() => {
    setShow(true)
  }, [])
  const src = siteInfo.sidebarIframeUrl?.trim()
  let hostname = ''
  try {
    hostname = src ? new URL(src).hostname : ''
  }
  catch {}
  // 地址为空或不合法时不显示
  if (!src || !hostname)
    return null
  const title = siteInfo.sidebarIframeTitle || hostname
  return (
    <SidebarCard title={title} contentClassName="overflow-hidden rounded-xl">
      {show && (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          style={{
            border: 'none',
            display: 'block',
            width: '100%',
            height: '300px',
            colorScheme: 'light dark',
          }}
        >
        </iframe>
      )}
    </SidebarCard>
  )
}
