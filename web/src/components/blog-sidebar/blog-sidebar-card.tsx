'use client'
import type { ComponentType } from 'react'
import type { ContentViewProps } from '@/components/content-components/content-component-view'
import type { Label } from '@/models/label'
import type { MisskeyFeed, MisskeyNote } from '@/models/misskey'
import type { Post } from '@/models/post'
import type { OwnerLink, SiteInfo } from '@/utils/common/siteinfo'
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, Eye, HeartIcon, ImageIcon, MessageCircleIcon, Repeat2Icon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { getLabels } from '@/api/label'
import { getMisskeyFeed } from '@/api/misskey'
import { listPosts } from '@/api/post'
import { ImageAvatar } from '@/components/common/avatar'
import { HoverPrefetchLink } from '@/components/common/hover-prefetch-link'
import { LinkPreviewScopeProvider } from '@/components/common/link-preview-context'
import { SafeImage } from '@/components/common/safe-image'
import { ScrollAffordance } from '@/components/common/scroll-affordance'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
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

function normalizeExternalHttpUrl(url?: string | null): string | undefined {
  if (!url)
    return undefined
  const trimmed = url.trim()
  if (!trimmed)
    return undefined
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      return undefined
    return trimmed
  }
  catch {
    return undefined
  }
}

export function isColdUnpopulatedMisskeyFeed(feed?: MisskeyFeed): boolean {
  return Boolean(feed && feed.enabled && !feed.fetchedAt && (!feed.notes || feed.notes.length === 0))
}

const MISSKEY_COLD_RETRY_DELAY_MS = 1500
const MISSKEY_INITIAL_LIMIT = 12
const MISSKEY_PAGE_LIMIT = 20
const MISSKEY_SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function isCollapsibleNoteText(text: string): boolean {
  if (text.length > 120)
    return true
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lines > 4)
      return true
  }
  return false
}

function mergeUniqueMisskeyNotes(existing: MisskeyNote[], incoming: MisskeyNote[]): MisskeyNote[] {
  if (incoming.length === 0)
    return existing
  const seen = new Set(existing.map(n => n.id))
  const merged = [...existing]
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      merged.push(item)
    }
  }
  return merged
}

function MisskeyNoteItem({
  note,
  isLatest,
  referenceNowMs,
}: {
  note: MisskeyNote
  isLatest: boolean
  referenceNowMs: number | null
}) {
  const t = useTranslations('Components.misskey')
  const format = useFormatter()
  const [cwExpanded, setCwExpanded] = useState(false)
  const [textExpanded, setTextExpanded] = useState(false)
  const hasCW = Boolean(note.cw && note.cw.trim() !== '')
  const showBody = !hasCW || cwExpanded
  const safeImages = (note.images ?? [])
    .map(img => ({ thumbnailUrl: normalizeExternalHttpUrl(img.thumbnailUrl), alt: img.alt }))
    .filter((img): img is { thumbnailUrl: string, alt: string } => Boolean(img.thumbnailUrl))
    .slice(0, 4)
  const safeNoteUrl = normalizeExternalHttpUrl(note.url)
  const quote = note.quote
  const safeQuoteUrl = normalizeExternalHttpUrl(quote?.url)
  const longText = Boolean(note.text && isCollapsibleNoteText(note.text))
  const reactionsCount = note.reactionsCount ?? 0
  const repliesCount = note.repliesCount ?? 0

  let displayTime = ''
  let exactTime = ''
  if (note.createdAt) {
    const parsed = new Date(note.createdAt)
    const noteMs = parsed.getTime()
    if (!Number.isNaN(noteMs)) {
      exactTime = format.dateTime(parsed, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      if (referenceNowMs !== null && referenceNowMs >= noteMs && referenceNowMs - noteMs < MISSKEY_SEVEN_DAYS_MS && typeof format.relativeTime === 'function') {
        displayTime = format.relativeTime(parsed, new Date(referenceNowMs))
      }
      else {
        const sameYear = referenceNowMs !== null
          && format.dateTime(parsed, { year: 'numeric' }) === format.dateTime(new Date(referenceNowMs), { year: 'numeric' })
        displayTime = format.dateTime(parsed, sameYear
          ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
          : { year: 'numeric', month: 'short', day: 'numeric' })
      }
    }
  }

  const hasQuoteContent = Boolean(quote && (quote.name || quote.username || quote.cw || quote.text || quote.hasMedia))
  const quoteInner = hasQuoteContent && quote && (
    <>
      {(quote.name || quote.username) && (
        <div className="mb-0.5 flex items-center gap-1 truncate font-medium text-foreground/75">
          {quote.name && <span className="truncate">{quote.name}</span>}
          {quote.username && (
            <span className="truncate text-muted-foreground">
              @
              {quote.username}
            </span>
          )}
        </div>
      )}
      {quote.cw
        ? (
            <p className="wrap-anywhere text-muted-foreground italic">
              [CW]
              {' '}
              {quote.cw}
            </p>
          )
        : quote.text
          ? (
              <p className="line-clamp-3 leading-snug wrap-anywhere whitespace-pre-line text-foreground/75">
                {quote.text}
              </p>
            )
          : null}
      {quote.hasMedia && (
        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <ImageIcon aria-hidden className="size-3 shrink-0" />
          <span>{t('quoted_media')}</span>
        </div>
      )}
    </>
  )

  return (
    <li className="group/note relative min-w-0 max-w-full pb-4 pl-3.5 last:pb-1">
      {/* 时间轴左轨节点：最新一条使用主色呼吸环锚定视觉焦点，其余条目悬停时点亮 */}
      <span
        aria-hidden
        className={cn(
          'absolute top-1.5 -left-[3px] size-[7px] rounded-full transition-colors duration-150',
          isLatest
            ? 'bg-primary ring-3 ring-primary/15'
            : 'bg-muted-foreground/35 group-hover/note:bg-primary',
        )}
      />

      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          {displayTime && (
            safeNoteUrl
              ? (
                  <a
                    href={safeNoteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={exactTime}
                    className="shrink-0 rounded-sm tabular-nums transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <time dateTime={note.createdAt} suppressHydrationWarning>
                      {displayTime}
                    </time>
                  </a>
                )
              : (
                  <time dateTime={note.createdAt} title={exactTime} suppressHydrationWarning className="shrink-0 tabular-nums">
                    {displayTime}
                  </time>
                )
          )}
          {note.isRenote && (
            <span className="inline-flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground/85">
              <Repeat2Icon aria-hidden className="size-3 shrink-0 text-primary/75" />
              <span className="truncate">
                {note.renoteUser ? t('renoted', { user: note.renoteUser }) : t('renoted_plain')}
              </span>
            </span>
          )}
        </div>
        {safeNoteUrl && (
          <a
            href={safeNoteUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('view_note')}
            title={t('view_note')}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 opacity-70 transition-[color,opacity] hover:text-primary group-hover/note:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLinkIcon aria-hidden className="size-3" />
          </a>
        )}
      </div>

      {hasCW && (
        <div className="mb-1.5 flex min-w-0 flex-wrap items-center justify-between gap-1.5 rounded-lg bg-secondary/65 px-2.5 py-1.5 text-xs">
          <span className="min-w-0 font-medium wrap-anywhere text-foreground/85">{note.cw}</span>
          {(note.text || safeImages.length > 0 || hasQuoteContent) && (
            <button
              type="button"
              aria-expanded={cwExpanded}
              onClick={() => setCwExpanded(v => !v)}
              className="inline-flex h-5 shrink-0 cursor-pointer items-center rounded-md bg-card px-2 text-[11px] font-medium text-secondary-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {cwExpanded ? t('hide_cw') : t('show_cw')}
            </button>
          )}
        </div>
      )}

      {showBody && note.text && (
        <div className="min-w-0">
          <p
            className={cn(
              'text-[13.5px] leading-relaxed wrap-anywhere whitespace-pre-line text-foreground/88',
              longText && !textExpanded && 'line-clamp-4',
            )}
          >
            {note.text}
          </p>
          {longText && (
            <button
              type="button"
              aria-expanded={textExpanded}
              onClick={() => setTextExpanded(v => !v)}
              className="mt-1 inline-flex cursor-pointer items-center gap-0.5 rounded-sm text-xs font-medium text-primary/85 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>{textExpanded ? t('collapse_text') : t('expand_text')}</span>
              {textExpanded ? <ChevronUpIcon aria-hidden className="size-3" /> : <ChevronDownIcon aria-hidden className="size-3" />}
            </button>
          )}
        </div>
      )}

      {showBody && quote && quoteInner && (
        safeQuoteUrl
          ? (
              <a
                href={safeQuoteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block min-w-0 max-w-full overflow-hidden rounded-lg border-l-2 border-primary/45 bg-muted/55 px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {quoteInner}
              </a>
            )
          : (
              <div className="mt-2 min-w-0 max-w-full overflow-hidden rounded-lg border-l-2 border-primary/45 bg-muted/55 px-2.5 py-1.5 text-xs">
                {quoteInner}
              </div>
            )
      )}

      {showBody && safeImages.length > 0 && (
        <div
          className={cn(
            'mt-2 grid w-full min-w-0 max-w-full gap-1.5',
            safeImages.length === 1 ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[repeat(2,minmax(0,1fr))]',
          )}
        >
          {safeImages.map((img, idx) => {
            const thumbNode = (
              <SafeImage
                src={img.thumbnailUrl}
                alt={img.alt || ''}
                fill
                sizes="(min-width: 1024px) 220px, 45vw"
                quality={60}
                loading="lazy"
                className="size-full max-w-full object-cover transition-transform duration-200 group-hover/img:scale-[1.02]"
              />
            )
            const boxClass = cn(
              'group/img relative block w-full min-w-0 max-w-full overflow-hidden rounded-lg bg-muted [contain:layout_paint] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              safeImages.length === 1 ? 'aspect-[16/10]' : 'aspect-[4/3]',
            )
            return safeNoteUrl
              ? (
                  <a
                    key={`${note.id}-img-${idx}`}
                    href={safeNoteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={img.alt || t('view_note')}
                    className={boxClass}
                  >
                    {thumbNode}
                  </a>
                )
              : (
                  <div key={`${note.id}-img-${idx}`} className={boxClass}>
                    {thumbNode}
                  </div>
                )
          })}
        </div>
      )}

      {(reactionsCount > 0 || repliesCount > 0) && (
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
          {reactionsCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <HeartIcon aria-hidden className="size-3 text-primary/70" />
              <span>{reactionsCount}</span>
            </span>
          )}
          {repliesCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageCircleIcon aria-hidden className="size-3" />
              <span>{repliesCount}</span>
            </span>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * 侧边栏个人动态流卡片（Misskey 驱动的轻量级个人动态区域）：
 * - 后端定时缓存最多 100 条公开动态；首屏 SSR 仅注入前 12 条控制 HTML/DOM 规模，用户在受限高度视口内滚动时按需分批渐进加载
 * - 采用时间轴左轨与单次顶部身份条排布，支持长文原地展开、结构化引用卡片与 CW 折叠保护，无 iframe、无 dangerouslySetInnerHTML、无常驻轮询
 */
export function BlogSidebarMisskey({ initialFeed }: { initialFeed?: MisskeyFeed }) {
  const t = useTranslations('Components.misskey')
  const [feed, setFeed] = useState<MisskeyFeed | undefined>(initialFeed)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const [clientNowMs, setClientNowMs] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)
  const feedEpochRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    setClientNowMs(Date.now())
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    feedEpochRef.current += 1
    const epoch = feedEpochRef.current
    loadingMoreRef.current = false
    setLoadingMore(false)
    setLoadMoreFailed(false)

    if (initialFeed !== undefined && !isColdUnpopulatedMisskeyFeed(initialFeed)) {
      setFeed(initialFeed)
      return
    }
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const pullOnce = (allowSingleRetry: boolean) => {
      getMisskeyFeed({ limit: MISSKEY_INITIAL_LIMIT })
        .then((res) => {
          if (cancelled || epoch !== feedEpochRef.current)
            return
          setFeed(res.data)
          if (allowSingleRetry && isColdUnpopulatedMisskeyFeed(res.data)) {
            retryTimer = setTimeout(() => {
              retryTimer = null
              if (!cancelled && epoch === feedEpochRef.current)
                pullOnce(false)
            }, MISSKEY_COLD_RETRY_DELAY_MS)
          }
        })
        .catch(() => {})
    }

    pullOnce(true)
    return () => {
      cancelled = true
      if (retryTimer !== null)
        clearTimeout(retryTimer)
    }
  }, [initialFeed])

  const notesCount = feed?.notes?.length ?? 0
  const hasMore = Boolean(feed?.hasMore)
  const nextCursor = feed?.nextCursor

  const loadMoreNotes = useCallback(() => {
    if (loadingMoreRef.current || !hasMore)
      return
    const epoch = feedEpochRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreFailed(false)

    getMisskeyFeed(
      nextCursor
        ? { limit: MISSKEY_PAGE_LIMIT, cursor: nextCursor }
        : { limit: MISSKEY_PAGE_LIMIT, offset: notesCount },
    )
      .then((res) => {
        if (!mountedRef.current || epoch !== feedEpochRef.current)
          return
        const incoming = res.data
        setFeed((prev) => {
          if (!prev)
            return incoming
          const merged = mergeUniqueMisskeyNotes(prev.notes, incoming.notes)
          const progressed = merged.length > prev.notes.length || Boolean(incoming.nextCursor && incoming.nextCursor !== prev.nextCursor)
          return {
            ...prev,
            fetchedAt: incoming.fetchedAt || prev.fetchedAt,
            total: incoming.total ?? prev.total,
            hasMore: Boolean(incoming.hasMore) && incoming.notes.length > 0 && progressed,
            nextCursor: incoming.nextCursor,
            notes: merged,
          }
        })
      })
      .catch(() => {
        if (mountedRef.current && epoch === feedEpochRef.current)
          setLoadMoreFailed(true)
      })
      .finally(() => {
        if (epoch !== feedEpochRef.current)
          return
        loadingMoreRef.current = false
        if (mountedRef.current)
          setLoadingMore(false)
      })
  }, [hasMore, nextCursor, notesCount])

  useEffect(() => {
    if (!hasMore || loadingMore || loadMoreFailed || typeof IntersectionObserver === 'undefined')
      return
    const rootEl = scrollRef.current
    const targetEl = sentinelRef.current
    if (!rootEl || !targetEl)
      return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(entry => entry.isIntersecting))
          loadMoreNotes()
      },
      { root: rootEl, rootMargin: '140px 0px' },
    )
    observer.observe(targetEl)
    return () => {
      observer.disconnect()
    }
  }, [hasMore, loadMoreFailed, loadMoreNotes, loadingMore])

  if (!feed || !feed.enabled || !feed.notes || feed.notes.length === 0)
    return null

  const user = feed.user
  const safeProfileUrl = normalizeExternalHttpUrl(user?.profileUrl)
  const safeAvatarUrl = normalizeExternalHttpUrl(user?.avatarUrl)
  const totalCount = Math.max(feed.total ?? feed.notes.length, feed.notes.length)

  // SSR 首帧以 fetchedAt 作为确定性时间基准，客户端挂载后平滑切换至当前时钟，杜绝水合文本不一致
  let referenceNowMs = clientNowMs
  if (referenceNowMs === null && feed.fetchedAt) {
    const parsedFetched = Date.parse(feed.fetchedAt)
    if (!Number.isNaN(parsedFetched))
      referenceNowMs = parsedFetched
  }

  return (
    <SidebarCard
      title={t('title')}
      className="[contain:inline-size]"
      action={(
        <div className="flex items-center gap-1.5">
          {totalCount > 0 && (
            <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground tabular-nums">
              {totalCount}
            </span>
          )}
          {safeProfileUrl && (
            <a
              href={safeProfileUrl}
              target="_blank"
              rel="noopener noreferrer me"
              aria-label={t('view_profile')}
              title={t('view_profile')}
              className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLinkIcon aria-hidden className="size-3.5" />
            </a>
          )}
        </div>
      )}
    >
      {user && (
        <div className="mb-3 flex items-center gap-2.5 border-b border-border/60 pb-2.5">
          <div className="relative shrink-0">
            <ImageAvatar
              src={safeAvatarUrl}
              alt={user.name || user.username}
              sizes="32px"
              className="size-8"
              fallback={<MessageCircleIcon aria-hidden className="size-4 text-muted-foreground" />}
            />
            <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card" />
          </div>
          <div className="min-w-0 flex-1">
            {safeProfileUrl
              ? (
                  <a
                    href={safeProfileUrl}
                    target="_blank"
                    rel="noopener noreferrer me"
                    className="block truncate text-sm font-semibold text-foreground/90 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {user.name || user.username}
                  </a>
                )
              : (
                  <div className="truncate text-sm font-semibold text-foreground/90">
                    {user.name || user.username}
                  </div>
                )}
            <div className="truncate text-xs text-muted-foreground">
              @
              {user.username}
            </div>
          </div>
        </div>
      )}

      <ScrollAffordance
        surface="card"
        viewportRef={scrollRef}
        showHintPill={false}
        className="[contain:inline-size]"
        viewportClassName="max-h-[25rem] pr-2.5 pb-1"
      >
        <ol className="relative ml-1.5 min-w-0 max-w-full before:absolute before:top-2 before:bottom-2 before:left-0 before:w-px before:bg-border/75">
          {feed.notes.map((note, idx) => (
            <MisskeyNoteItem
              key={note.id}
              note={note}
              isLatest={idx === 0}
              referenceNowMs={referenceNowMs}
            />
          ))}
        </ol>

        {hasMore && (
          <div ref={sentinelRef} className="pt-1 pb-1.5 pl-5">
            <button
              type="button"
              disabled={loadingMore}
              onClick={loadMoreNotes}
              className="inline-flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-secondary/60 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {loadingMore && <Spinner className="size-3" />}
              <span>{loadingMore ? t('loading_more') : t('load_more')}</span>
            </button>
          </div>
        )}

        {!hasMore && feed.notes.length > 3 && safeProfileUrl && (
          <div className="pt-1.5 pb-1.5 pl-5 text-center">
            <a
              href={safeProfileUrl}
              target="_blank"
              rel="noopener noreferrer me"
              className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>{t('view_all_on_misskey')}</span>
              <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
            </a>
          </div>
        )}
      </ScrollAffordance>
    </SidebarCard>
  )
}
