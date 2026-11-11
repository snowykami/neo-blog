'use client'

import type { Post } from '@/models/post'
import { CopyCheckIcon, DownloadIcon, LinkIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { FaQq, FaTelegram, FaWeibo, FaWeixin, FaXTwitter } from 'react-icons/fa6'
import { toast } from 'sonner'
import { notifySuccess } from '@/components/layout/topbar-island/island-feedback'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useSiteInfo } from '@/contexts/site-info-context'
import { ShareIcon } from '@/contexts/theme-context'
import { localizePath } from '@/i18n/routing'
import copyToClipboard from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { getPostShareImageUrl, getPostUrl } from '@/utils/common/route'

/*
 * 文章分享：先给出服务端生成的分享图（与爬虫抓到的 og:image 是同一张），再给各平台的快捷分享入口
 * - 分享链接必须是绝对地址，社交平台不会补全相对路径；站点未配置 baseUrl 时退回当前域名
 * - 微信不支持网页直接分享，只做「复制链接」并提示粘贴到聊天窗口
 */

interface SharePlatform {
  key: 'x' | 'telegram' | 'qq' | 'weibo'
  icon: React.ReactNode
  href: string
}

export function BlogShare({ post }: { post: Pick<Post, 'id' | 'slug' | 'title' | 'description' | 'updatedAt'> }) {
  const t = useTranslations('Share')
  const locale = useLocale()
  const { siteInfo } = useSiteInfo()
  // 分享链接与分享图都用当前语言的地址，与页面的 canonical、og:image 一致
  const imagePath = localizePath(getPostShareImageUrl(post), locale)
  const base = siteInfo.baseUrl?.replace(/\/+$/, '') ?? ''
  const [absoluteBase, setAbsoluteBase] = useState(base)
  const [canNativeShare, setCanNativeShare] = useState(false)
  // 分享图由服务端现场生成，首次打开要等一会儿：记下已加载完的地址，地址变了（补上绝对域名）重新显示加载态
  const [loadedImage, setLoadedImage] = useState<string | null>(null)

  useEffect(() => {
    // 站点未配置 baseUrl 时用当前域名兜底；分享链接必须是绝对地址，社交平台不会补全
    setAbsoluteBase(base || window.location.origin)
    setCanNativeShare(typeof navigator.share === 'function')
  }, [base])

  const shareUrl = `${absoluteBase}${localizePath(getPostUrl({ post }), locale)}`
  const imageUrl = `${absoluteBase}${imagePath}`
  const title = post.title || siteInfo.metadata.name
  const description = post.description || siteInfo.metadata.description
  const encode = encodeURIComponent
  const imageLoaded = loadedImage === imageUrl

  const platforms: SharePlatform[] = [
    {
      key: 'x',
      icon: <FaXTwitter aria-hidden />,
      href: `https://twitter.com/intent/tweet?url=${encode(shareUrl)}&text=${encode(title)}`,
    },
    {
      key: 'telegram',
      icon: <FaTelegram aria-hidden />,
      href: `https://t.me/share/url?url=${encode(shareUrl)}&text=${encode(title)}`,
    },
    {
      key: 'qq',
      icon: <FaQq aria-hidden />,
      href: `https://connect.qq.com/widget/shareqq/index.html?url=${encode(shareUrl)}&title=${encode(title)}&desc=${encode(description)}`,
    },
    {
      key: 'weibo',
      icon: <FaWeibo aria-hidden />,
      href: `https://service.weibo.com/share/share.php?url=${encode(shareUrl)}&title=${encode(title)}&pic=${encode(imageUrl)}`,
    },
  ]

  const copyLink = (message = t('copy_success')) => {
    copyToClipboard(shareUrl)
      .then(ok => (ok ? notifySuccess(message, { key: 'copy', icon: <CopyCheckIcon aria-hidden className="text-emerald-400" />, countable: true }) : toast.error(t('copy_failed'))))
      .catch(() => toast.error(t('copy_failed')))
  }

  const nativeShare = () => {
    navigator.share({ title, text: description, url: shareUrl }).catch(() => {
      // 用户取消分享时不需要提示
    })
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="lg" className="gap-2 rounded-lg">
          <ShareIcon />
          {t('share')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>
        <a
          href={imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex justify-center overflow-hidden rounded-lg border bg-muted"
          title={t('preview_alt')}
          aria-busy={!imageLoaded}
        >
          <Image
            src={imageUrl}
            alt={t('preview_alt')}
            width={1080}
            height={1350}
            unoptimized
            // 竖版卡片（4:5）：按高度上限反推宽度，等比例缩放且加载前后不跳高度
            className={cn('h-auto w-full max-w-[min(100%,45vh)] transition-opacity duration-200', !imageLoaded && 'opacity-0')}
            onLoad={() => setLoadedImage(imageUrl)}
            // 加载失败时同样收起骨架，露出浏览器的图片占位
            onError={() => setLoadedImage(imageUrl)}
          />
          {!imageLoaded && (
            <Skeleton className="absolute inset-0 grid place-items-center rounded-none">
              <Spinner className="text-muted-foreground size-6" />
            </Skeleton>
          )}
        </a>
        {/* 只放图标：按当前按钮高度排成一行，名称交给 title / aria-label */}
        <div className="flex flex-wrap items-center gap-2">
          {platforms.map((platform) => {
            const label = t(`platforms.${platform.key}`)
            return (
              <Button key={platform.key} variant="outline" size="icon" asChild>
                <a
                  href={platform.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={label}
                  aria-label={label}
                >
                  {platform.icon}
                </a>
              </Button>
            )
          })}
          <Button
            variant="outline"
            size="icon"
            title={t('platforms.wechat')}
            aria-label={t('platforms.wechat')}
            onClick={() => copyLink(t('wechat_hint'))}
          >
            <FaWeixin aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title={t('copy_link')}
            aria-label={t('copy_link')}
            onClick={() => copyLink()}
          >
            <LinkIcon aria-hidden />
          </Button>
          <Button variant="outline" size="icon" asChild>
            <a
              href={imageUrl}
              download={`${post.slug || post.id}.png`}
              title={t('download')}
              aria-label={t('download')}
            >
              <DownloadIcon aria-hidden />
            </a>
          </Button>
          {canNativeShare && (
            <Button
              variant="outline"
              size="icon"
              title={t('native')}
              aria-label={t('native')}
              onClick={nativeShare}
            >
              <ShareIcon />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
