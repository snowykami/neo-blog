'use client'

import type { Post } from '@/models/post'
import { DownloadIcon, LinkIcon, Share2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { FaQq, FaTelegram, FaWeibo, FaWeixin, FaXTwitter } from 'react-icons/fa6'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useSiteInfo } from '@/contexts/site-info-context'
import copyToClipboard from '@/lib/clipboard'
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

export function BlogShare({ post }: { post: Post }) {
  const t = useTranslations('Share')
  const { siteInfo } = useSiteInfo()
  const imagePath = getPostShareImageUrl(post)
  const base = siteInfo.baseUrl?.replace(/\/+$/, '') ?? ''
  const [absoluteBase, setAbsoluteBase] = useState(base)
  const [canNativeShare, setCanNativeShare] = useState(false)

  useEffect(() => {
    // 站点未配置 baseUrl 时用当前域名兜底；分享链接必须是绝对地址，社交平台不会补全
    setAbsoluteBase(base || window.location.origin)
    setCanNativeShare(typeof navigator.share === 'function')
  }, [base])

  const shareUrl = `${absoluteBase}${getPostUrl({ post })}`
  const imageUrl = `${absoluteBase}${imagePath}`
  const title = post.title || siteInfo.metadata.name
  const description = post.description || siteInfo.metadata.description
  const encode = encodeURIComponent

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
      .then(ok => (ok ? toast.success(message) : toast.error(t('copy_failed'))))
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
          <Share2Icon aria-hidden />
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
          className="block overflow-hidden rounded-lg border bg-muted"
          title={t('preview_alt')}
        >
          <Image
            src={imageUrl}
            alt={t('preview_alt')}
            width={1200}
            height={630}
            unoptimized
            className="h-auto w-full"
          />
        </a>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {platforms.map(platform => (
            <Button key={platform.key} variant="outline" className="justify-start" asChild>
              <a href={platform.href} target="_blank" rel="noopener noreferrer">
                {platform.icon}
                {t(`platforms.${platform.key}`)}
              </a>
            </Button>
          ))}
          <Button variant="outline" className="justify-start" onClick={() => copyLink(t('wechat_hint'))}>
            <FaWeixin aria-hidden />
            {t('platforms.wechat')}
          </Button>
          <Button variant="outline" className="justify-start" onClick={() => copyLink()}>
            <LinkIcon aria-hidden />
            {t('copy_link')}
          </Button>
          <Button variant="outline" className="justify-start" asChild>
            <a href={imageUrl} download={`${post.slug || post.id}.png`}>
              <DownloadIcon aria-hidden />
              {t('download')}
            </a>
          </Button>
          {canNativeShare && (
            <Button variant="outline" className="justify-start" onClick={nativeShare}>
              <Share2Icon aria-hidden />
              {t('native')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
