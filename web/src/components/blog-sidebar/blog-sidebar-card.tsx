'use client'
import type { ComponentType } from 'react'
import type { ContentViewProps } from '@/components/content-components/content-component-view'
import type { Label } from '@/models/label'
import type { Post } from '@/models/post'
import type { OwnerLink, SiteInfo } from '@/utils/common/siteinfo'
import { ChevronDownIcon, ChevronUpIcon, Eye } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Suspense, useEffect, useState } from 'react'
import { getLabels } from '@/api/label'
import { listPosts } from '@/api/post'
import { ImageAvatar } from '@/components/common/avatar'
import { HoverPrefetchLink } from '@/components/common/hover-prefetch-link'
import { LinkPreviewScopeProvider } from '@/components/common/link-preview-context'
import { SafeImage } from '@/components/common/safe-image'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSiteInfo } from '@/contexts/site-info-context'
import { LikeIcon } from '@/contexts/theme-context'
import { Link, useRouter } from '@/i18n/navigation'
import { OwnerLinkIcon } from '@/lib/social-icons/icon-spec-svg'
import { DEFAULT_OWNER_LINK_ICON, fallbackLabelFromIconName, isSafeOwnerLinkUrl } from '@/lib/social-icons/types'
import { cn } from '@/lib/utils'
import { OrderBy } from '@/models/common'
import { getGravatarUrl } from '@/utils/common/gravatar'
import { getLabelUrl, getPostUrl } from '@/utils/common/route'
import { isLikeEnabled } from '@/utils/common/siteinfo'
import { getFallbackAvatarFromUsername } from '@/utils/common/username'
import { SidebarCard } from './sidebar-card'
import { getSidebarCards } from './sidebar-cards'

// 桌面侧栏与移动首屏名片条共享完全一致的头像地址与 sizes 档位：
// 1. 同一套 sizes/quality 保证两处生成字节级相同的 /_next/image 地址，跨断点缩放或滑到底部时 100% 命中内存缓存；
// 2. 不传 eager（使用默认 loading="lazy"），使 display:none（桌面端的 lg:hidden 横幅）与移动端屏外页底侧栏不会提前并发重复请求
function resolveOwnerAvatar(siteInfo: SiteInfo) {
  const { owner, aboutBackground } = siteInfo
  const avatarSrc = owner?.avatar || (owner?.gravatarEmail ? getGravatarUrl({ email: owner.gravatarEmail, size: 160 }) : undefined)
  const avatarSizes = aboutBackground ? '80px' : '64px'
  const name = owner?.name || siteInfo.metadata.name
  return { owner, aboutBackground, avatarSrc, avatarSizes, name }
}

function OwnerSocialLinks({ links, compact = false }: { links?: OwnerLink[], compact?: boolean }) {
  const validLinks = (links ?? []).filter(item => item.url && isSafeOwnerLinkUrl(item.url))
  if (validLinks.length === 0)
    return null

  const buttonClass = cn(
    'inline-flex items-center justify-center rounded-xl bg-primary/10 text-primary transition-[background-color,color,transform] duration-150 hover:bg-primary/20 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    compact ? 'size-9' : 'size-10',
  )
  const iconClass = compact ? 'size-[1.125rem]' : 'size-5'

  return (
    <div className={cn('mt-3 flex flex-wrap gap-2', !compact && 'justify-center')}>
      {validLinks.map((link, index) => {
        const href = link.url.trim()
        const label = link.name?.trim() || link.resolvedLabel || fallbackLabelFromIconName(link.icon || DEFAULT_OWNER_LINK_ICON)
        const iconNode = <OwnerLinkIcon icon={link.icon} resolved={link.resolvedIcon} className={iconClass} />
        const isHttp = /^https?:\/\//i.test(href)
        const isRawRootAsset = /^\/(?:api\/|(?:rss|feed|atom)(?:\.xml)?(?:$|[/?#]))/i.test(href)
        const isInternalPage = href.startsWith('/') && !isRawRootAsset

        const trigger = isInternalPage
          ? (
              <Link href={href} aria-label={label} className={buttonClass}>
                {iconNode}
              </Link>
            )
          : (
              <a
                href={href}
                target={isHttp || isRawRootAsset ? '_blank' : undefined}
                rel={isHttp ? 'noopener noreferrer me' : isRawRootAsset ? 'noopener noreferrer' : undefined}
                aria-label={label}
                className={buttonClass}
              >
                {iconNode}
              </a>
            )

        return (
          <Tooltip key={`${href}-${index}`}>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>{label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

// 关于我卡片（参考 Fuwari 的 Profile，MIT License, saicaca/fuwari）：
// 配置了背景图时背景图作为横幅，头像压在横幅下沿；无背景图时采用精致紧凑的横向名片排布，避免巨幅占位挤压侧栏高度
export function BlogSidebarAbout() {
  const { siteInfo } = useSiteInfo()
  if (!siteInfo)
    return null
  const { owner, aboutBackground, avatarSrc, avatarSizes, name } = resolveOwnerAvatar(siteInfo)
  if (!aboutBackground) {
    return (
      <SidebarCard className="p-4">
        <div className="flex items-start gap-3.5">
          <ImageAvatar
            src={avatarSrc}
            alt={name}
            fallback={getFallbackAvatarFromUsername(name)}
            sizes={avatarSizes}
            className="size-14 shrink-0 rounded-2xl"
            fallbackClassName="bg-secondary text-xl font-bold text-secondary-foreground"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold text-foreground/90">{name}</div>
            <div aria-hidden className="my-1.5 h-1 w-5 rounded-full bg-primary" />
            {owner?.motto && <p className="text-sm leading-snug text-foreground/75">{owner.motto}</p>}
            {owner?.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{owner.description}</p>}
          </div>
        </div>
        <OwnerSocialLinks links={owner?.links} compact />
      </SidebarCard>
    )
  }
  return (
    <SidebarCard className="p-3">
      <div className="mb-3">
        <div className="relative aspect-[2/1] w-full overflow-hidden rounded-xl bg-muted">
          {/* 桌面端侧栏在首屏内：无首屏封面时常作为 LCP 元素，设为 eager + fetchPriority="high" 尽早开始下载 */}
          <SafeImage src={aboutBackground} alt="" fill sizes="280px" quality={60} loading="eager" fetchPriority="high" className="object-cover" />
        </div>
        <ImageAvatar
          src={avatarSrc}
          alt={name}
          fallback={getFallbackAvatarFromUsername(name)}
          sizes={avatarSizes}
          className="relative mx-auto -mt-10 size-20 ring-4 ring-card"
          fallbackClassName="bg-secondary text-2xl font-bold text-secondary-foreground"
        />
      </div>
      <div className="px-2 pb-1 text-center">
        <div className="mb-1 text-xl font-bold text-foreground/90">{name}</div>
        <div aria-hidden className="mx-auto mb-2 h-1 w-5 rounded-full bg-primary" />
        {owner?.motto && <p className="mb-1 text-foreground/75">{owner.motto}</p>}
        {owner?.description && <p className="text-sm text-muted-foreground">{owner.description}</p>}
        <OwnerSocialLinks links={owner?.links} />
      </div>
    </SidebarCard>
  )
}

/**
 * 移动端首页首屏站长紧凑名片条（lg 以下展示）：
 * 窄屏下右侧栏落到整页文章最底部，首屏放一条轻量名片让新访客立刻认识站点主人；后台关闭「关于」卡片时同步隐藏
 */
export function BlogMobileOwnerBanner() {
  const { siteInfo } = useSiteInfo()
  if (!siteInfo || !getSidebarCards(siteInfo).some(card => card.type === 'about'))
    return null
  const { owner, avatarSrc, avatarSizes, name } = resolveOwnerAvatar(siteInfo)
  const subtitle = owner?.motto || owner?.description || siteInfo.metadata.description
  if (!name)
    return null
  return (
    <div className="surface-card flex items-center gap-3 rounded-2xl bg-card p-3.5 lg:hidden">
      <ImageAvatar
        src={avatarSrc}
        alt={name}
        fallback={getFallbackAvatarFromUsername(name)}
        sizes={avatarSizes}
        className="size-11 shrink-0 rounded-full"
        fallbackClassName="bg-secondary text-sm font-bold text-secondary-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold text-foreground/90">{name}</span>
          <span aria-hidden className="h-1 w-3.5 shrink-0 rounded-full bg-primary" />
        </div>
        {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  )
}

// 热门 / 最新文章卡片：orderType 决定获取顺序与标题
export function BlogSidebarHotPosts({ posts: initialPosts, orderType = OrderBy.Heat }: { posts?: Post[], orderType?: OrderBy.Heat | OrderBy.CreatedAt }) {
  const { siteInfo } = useSiteInfo()
  const likeEnabled = isLikeEnabled(siteInfo)
  const blogHomeT = useTranslations('BlogHome')
  const metricsT = useTranslations('Metrics')
  const [posts, setPosts] = useState<Post[]>(initialPosts ?? [])
  const isLatest = orderType === OrderBy.CreatedAt
  useEffect(() => {
    if (initialPosts !== undefined) {
      setPosts(initialPosts)
      return
    }
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
            <HoverPrefetchLink
              href={getPostUrl({ post })}
              className="group flex items-start gap-3 rounded-lg p-2 transition-colors duration-150 hover:bg-primary/10"
            >
              <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-sm font-bold text-secondary-foreground tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium text-foreground/75 transition-colors duration-150 group-hover:text-primary">{post.title}</div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  <span className="flex items-center gap-1">
                    <Eye aria-hidden className="size-3" />
                    <span className="sr-only">{metricsT('view_count')}</span>
                    {post.viewCount}
                  </span>
                  {likeEnabled && (
                    <span className="flex items-center gap-1">
                      <LikeIcon className="size-3" />
                      <span className="sr-only">{metricsT('like_count')}</span>
                      {post.likeCount}
                    </span>
                  )}
                </div>
              </div>
            </HoverPrefetchLink>
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
  initialLabels,
}: {
  label?: string | null
  setLabel?: (label: string | null) => void
  initialLabels?: Label[]
}) {
  const t = useTranslations('Common')
  const [labels, setLabels] = useState<Label[]>(initialLabels ?? [])
  const [expanded, setExpanded] = useState(false)
  const router = useRouter()
  useEffect(() => {
    if (initialLabels !== undefined) {
      setLabels(initialLabels)
      return
    }
    let cancelled = false
    getLabels()
      .then((res) => {
        if (!cancelled)
          setLabels((res.data.labels || []).filter(l => (l.postCount ?? 0) > 0))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [initialLabels])

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
              <span className={cn('text-xs tabular-nums', selected ? 'text-primary-foreground' : 'text-muted-foreground')}>{(l.postCount ?? 0) > 99 ? '99+' : l.postCount}</span>
            </button>
          )
        })}
      </div>
      {collapsible && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-muted-foreground hover:text-primary"
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

// 侧边栏嵌入页面（如 Misskey 时间线）；只在客户端渲染 iframe，避免 hydration 报错
export function SidebarIframeCard({ title, url, height }: { title: string, url: string, height: number }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    setShow(true)
  }, [])
  let hostname = ''
  try {
    hostname = new URL(url).hostname
  }
  catch {}
  if (!hostname)
    return null
  const cardTitle = title || hostname
  return (
    <SidebarCard title={cardTitle} contentClassName="overflow-hidden rounded-xl">
      {show && (
        <iframe
          src={url}
          title={cardTitle}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          style={{
            border: 'none',
            display: 'block',
            width: '100%',
            height: `${height}px`,
            colorScheme: 'light dark',
          }}
        >
        </iframe>
      )}
    </SidebarCard>
  )
}

// 文章组件块作为侧边栏卡片：有标题时放在标准卡片内，否则直接展示组件（如天气卡、仓库卡）
export function SidebarComponentCard({ title, name, props, version }: { title: string, name: string, props: Record<string, unknown>, version?: number }) {
  // 防退化约束（两层隔离）：
  // 1. 为什么在 useEffect 中动态 import() 而不是文件顶层静态导入：侧边栏几乎出现在所有前台页面，
  //    动态导入保证未配置组件卡片的站点连 runtime-registry 映射表都不会进首屏包；
  // 2. 为什么只引入 runtime + ContentView（严禁引入 props.ts / registry.ts）：保持与 sidebar-cards.ts 一致的
  //    前台 0 Zod 边界，避免把 zod 与全部组件 schema（约 144 KiB raw）拉进访客首屏
  const [resolved, setResolved] = useState<{
    component: ComponentType<any>
    View: ComponentType<ContentViewProps>
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    setResolved(null)
    void Promise.all([
      import('@/components/content-components/runtime'),
      import('@/components/content-components/content-component-view'),
    ])
      .then(([{ getRuntimeContentComponent }, { ContentView }]) => {
        if (cancelled)
          return
        const entry = getRuntimeContentComponent(name, version)
        if (!entry)
          return
        setResolved({ component: entry.component, View: ContentView })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [name, version])
  // 组件被删除或版本过高时不渲染（保存配置时已校验过，这里只是兜底）
  if (!resolved)
    return null
  const { component, View } = resolved
  const view = (
    <LinkPreviewScopeProvider targetType="sidebar">
      <View component={component} props={props} className="my-0" />
    </LinkPreviewScopeProvider>
  )
  // 组件本体通过 React.lazy 按需加载、不带 Suspense 边界：在这里接住挂起（整张卡片等组件代码到了再出现），
  // 免得冒泡到路由的 loading 边界把整页换回骨架
  return <Suspense fallback={null}>{title ? <SidebarCard title={title}>{view}</SidebarCard> : view}</Suspense>
}
