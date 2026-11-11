import type { ComponentType, ReactNode } from 'react'
import type { Post } from '@/models/post'
import {
  ClockIcon,
  FileTextIcon,
  FolderIcon,
  HashIcon,
  PenLineIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Fragment } from 'react'
import { UserAvatar } from '@/components/common/avatar'
import { CommentIcon, LikeIcon, ViewIcon } from '@/contexts/theme-context'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { getCategoryUrl, getLabelUrl, getUserUrl } from '@/utils/common/route'
import { PostMetaDates } from './post-meta-dates'
import { PostMetaItem } from './post-meta-item'

export { PostMetaItem }

/*
 * 文章元信息（参考 Fuwari 的 PostMetadata，MIT License, saicaca/fuwari）
 * 不使用客户端专属能力：next-intl 的 useTranslations / useFormatter 在服务端组件与客户端组件中都可用，
 * 因此首页列表（客户端）与文章页（服务端）共用同一套实现
 */

// 元信息中的链接：位于整卡链接（stretched link）之上，需提升层级
const metaLinkClass = 'relative z-10 rounded-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** 头像 + 昵称的作者项（列表），整体链接到作者主页 */
function PostAuthorAvatarItem({ user }: { user: Post['user'] }) {
  const t = useTranslations()
  const name = user?.nickname || user?.username || t('Common.unknown_author')
  const content = (
    <>
      {/* 头像仅作装饰，读屏只读「作者 + 昵称」，避免首字母兜底被重复朗读 */}
      {user && (
        <span aria-hidden className="mr-2 shrink-0">
          <UserAvatar user={user} size={56} alt="" className="size-7" />
        </span>
      )}
      <span className="sr-only">{t('Copyright.author')}</span>
      <span className="block max-w-[16ch] truncate">{name}</span>
    </>
  )
  const itemClass = 'flex min-w-0 items-center text-sm font-medium text-foreground/50'

  return user?.username
    ? <Link href={getUserUrl(user, 'posts')} className={cn(metaLinkClass, itemClass)}>{content}</Link>
    : <div className={itemClass}>{content}</div>
}

export function PostMeta({
  post,
  showAuthor = false,
  authorAvatar = false,
  showUpdated = false,
  className,
}: {
  post: Post
  /** 显示作者（文章页） */
  showAuthor?: boolean
  /** 作者以头像代替图标块展示（列表） */
  authorAvatar?: boolean
  /** 更新时间与发布时间不在同一天时额外显示更新时间（文章页） */
  showUpdated?: boolean
  className?: string
}) {
  const t = useTranslations()
  const labels = post.labels ?? []

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      {showAuthor && authorAvatar && <PostAuthorAvatarItem user={post.user} />}
      {showAuthor && !authorAvatar && (
        <PostMetaItem icon={PenLineIcon} label={t('Copyright.author')}>
          <Link href={getUserUrl(post.user, 'posts')} className={cn(metaLinkClass, 'block max-w-[16ch] truncate')}>
            {post.user.nickname || post.user.username || t('Common.unknown_author')}
          </Link>
        </PostMetaItem>
      )}
      {/* 发布 / 更新日期按访客本机时区显示，交给客户端组件（服务端组件格式化出的文本水合后不会变） */}
      <PostMetaDates createdAt={post.createdAt} updatedAt={post.updatedAt} showUpdated={showUpdated} />
      <PostMetaItem icon={FolderIcon} label={t('Route.category')}>
        {post.category
          ? (
              <Link href={getCategoryUrl(post.category)} className={metaLinkClass}>
                {post.category.name}
              </Link>
            )
          : t('Common.uncategorized')}
      </PostMetaItem>
      {labels.length > 0 && (
        <PostMetaItem icon={HashIcon} label={t('Route.label')}>
          {/* 多个标签用 / 分隔 */}
          <span className="flex flex-wrap items-center">
            {labels.map((label, index) => (
              <Fragment key={label.id}>
                {index > 0 && <span aria-hidden className="mx-1.5 text-foreground/30">/</span>}
                {/* 标签页是带 ?label= 的首页：进入视口只预取首页的 App Shell（与其他首页链接共用一份，点击立刻出骨架）；
                    悬停不升级为按链接预取（带筛选的列表不进取数缓存，每次悬停都要打后端） */}
                <Link href={getLabelUrl(label)} unstable_dynamicOnHover={false} className={metaLinkClass}>
                  {label.name}
                </Link>
              </Fragment>
            ))}
          </span>
        </PostMetaItem>
      )}
    </div>
  )
}

/**
 * 字数与阅读时长：需传入完整正文计算（列表接口的正文已截断，因此只在文章页展示）；withIcons 时带小图标块
 */
export function PostStats({
  words,
  minutes,
  views,
  likes,
  comments,
  withIcons = false,
  className,
}: {
  words: number
  minutes: number
  // 浏览量/点赞/评论为可选：独立页面没有这些统计，传 undefined 时不渲染对应项
  views?: number
  likes?: number
  comments?: number
  withIcons?: boolean
  className?: string
}) {
  const t = useTranslations('Common')
  // key 用固定的统计项名，不用文本值：浏览量/点赞数同为 0 或相等时文本 key 会重复
  // 图标统一收敛成同一签名：这些图标会随主题包变化（见 contexts/theme-context）
  const items: { key: string, icon: ComponentType<{ className?: string }>, text: ReactNode }[] = [
    { key: 'words', icon: FileTextIcon, text: t('word_count', { count: words }) },
    { key: 'minutes', icon: ClockIcon, text: t('reading_time', { count: minutes }) },
    ...(views === undefined ? [] : [{ key: 'views', icon: ViewIcon, text: views }]),
    ...(likes === undefined ? [] : [{ key: 'likes', icon: LikeIcon, text: likes }]),
    ...(comments === undefined ? [] : [{ key: 'comments', icon: CommentIcon, text: comments }]),
  ]
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground/30 tabular-nums', withIcons && 'gap-x-5', className)}>
      {items.map(item => (
        <div key={item.key} className="flex items-center">
          {withIcons && (
            <span aria-hidden className="mr-2 flex size-6 items-center justify-center rounded-md bg-foreground/5 text-foreground/50">
              <item.icon className="size-3.5" />
            </span>
          )}
          {item.text}
        </div>
      ))}
    </div>
  )
}
