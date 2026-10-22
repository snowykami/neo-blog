'use client'
import type { Label } from '@/models/label'
import type { Post } from '@/models/post'
import { Clock, Eye, Heart, TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getLabels } from '@/api/label'
import { listPosts } from '@/api/post'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSiteInfo } from '@/contexts/site-info-context'
import { cn } from '@/lib/utils'
import { OrderBy } from '@/models/common'
import { getGravatarUrl } from '@/utils/common/gravatar'
import { getLabelUrl, getPostUrl } from '@/utils/common/route'
import { getFallbackAvatarFromUsername } from '@/utils/common/username'

// 侧边栏父组件，接收卡片组件列表
// 关于我卡片
export function BlogSidebarAbout() {
  const { siteInfo } = useSiteInfo()
  const routeT = useTranslations('Route')
  if (!siteInfo)
    return null
  const { owner, aboutBackground } = siteInfo
  // 优先使用站长头像，其次 Gravatar 邮箱；都没有时显示名称首字
  const avatarSrc = owner?.avatar || (owner?.gravatarEmail ? getGravatarUrl({ email: owner.gravatarEmail, size: 256 }) : undefined)
  return (
    <Card className={cn('relative overflow-hidden', aboutBackground && 'text-white')}>
      {aboutBackground && (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center blur-sm"
            style={{
              backgroundImage: `url(${JSON.stringify(aboutBackground)})`,
              filter: 'blur(4px)',
              transform: 'scale(1.1)', // 避免模糊边缘
            }}
          />
          <div className="absolute inset-0 bg-white/0 dark:bg-gray-900/20" />
        </>
      )}
      <div className="relative z-10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 ">
            <Heart className="w-5 h-5 text-red-500" />
            {routeT('about')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center mb-4">
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
              <Avatar className="h-full w-full rounded-full border-2">
                {avatarSrc && <AvatarImage src={avatarSrc} alt={owner?.name} />}
                <AvatarFallback className="rounded-full">
                  {getFallbackAvatarFromUsername(owner?.name || siteInfo.metadata.name)}
                </AvatarFallback>
              </Avatar>
            </div>
            {owner?.name && <h3 className="font-semibold text-lg py-4">{owner.name}</h3>}
            {owner?.motto && <p className="text-sm italic mb-2">{owner.motto}</p>}
            {owner?.description && <p className="text-sm">{owner.description}</p>}
          </div>
        </CardContent>
      </div>
    </Card>
  )
}

// 热门 / 最新文章卡片：orderType 决定获取顺序与标题
export function BlogSidebarHotPosts({ posts: initialPosts, orderType = OrderBy.Heat }: { posts?: Post[], orderType?: OrderBy.Heat | OrderBy.CreatedAt }) {
  const blogHomeT = useTranslations('BlogHome')
  const [posts, setPosts] = useState<Post[]>(initialPosts ?? [])
  const isLatest = orderType === OrderBy.CreatedAt
  useEffect(() => {
    // 未传入文章时从服务器获取
    if (initialPosts && initialPosts.length > 0)
      return
    let cancelled = false
    listPosts({ orderBy: orderType, page: 1, size: 3, noContent: true })
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
  const TitleIcon = isLatest ? Clock : TrendingUp
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TitleIcon className="w-5 h-5 text-orange-500" />
          {isLatest ? blogHomeT('latest_posts') : blogHomeT('hottest_posts')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {posts.slice(0, 3).map((post, index) => (
          <Link
            href={getPostUrl({ post })}
            key={post.id}
            className="block hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg p-1 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold">
                {index + 1}
              </span>
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm line-clamp-2 mb-1">{post.title}</h4>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    {post.viewCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="w-3 h-3" />
                    {post.likeCount}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

// 标签云卡片
export function BlogSidebarLabels({
  label = null,
  setLabel,
}: {
  label?: string | null
  setLabel?: (label: string | null) => void
}) {
  const t = useTranslations()
  const [labels, setLabels] = useState<Label[]>([])
  const router = useRouter()
  useEffect(() => {
    getLabels().then((res) => {
      setLabels(res.data.labels || [])
    })
  }, [])

  const onClickLabel = (l: Label) => {
    if (setLabel) {
      setLabel(label === l.slug ? null : l.slug)
    }
    else {
      router.push(getLabelUrl(l))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Common.labels_cloud')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {labels.map(
            l =>
              !!l.postCount
              && l.postCount > 0 && (
                <div key={l.id} className="relative">
                  <Badge
                    asChild
                    variant="outline"
                    className={`text-xs hover:bg-blue-50 cursor-pointer ${label === l.slug ? ' bg-blue-100 text-blue-700 hover:bg-blue-200' : ''}`}
                  >
                    <button
                      type="button"
                      aria-pressed={setLabel ? label === l.slug : undefined}
                      onClick={() => onClickLabel(l)}
                    >
                      {l.name}
                    </button>
                  </Badge>
                  <span aria-hidden className="absolute -top-1.5 -right-1.5 bg-primary/70 text-[10px] rounded-full w-4.5 h-4.5 flex items-center justify-center pointer-events-none">
                    {l.postCount > 0 ? (l.postCount > 99 ? '99+' : l.postCount) : 0}
                  </span>
                </div>
              ),
          )}
        </div>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {show && (
          <iframe
            src={src}
            title={title}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            style={{
              border: 'none',
              width: '100%',
              maxWidth: '500px',
              height: '300px',
              colorScheme: 'light dark',
            }}
          >
          </iframe>
        )}
      </CardContent>
    </Card>
  )
}
