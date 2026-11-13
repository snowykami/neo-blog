'use client'

import type { Post } from '@/models/post'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ShareIcon } from '@/contexts/theme-context'

/*
 * 文章分享：先给出服务端生成的分享图（与爬虫抓到的 og:image 是同一张），再给各平台的快捷分享入口
 * - 分享链接必须是绝对地址，社交平台不会补全相对路径；站点未配置 baseUrl 时退回当前域名
 * - 微信不支持网页直接分享，只做「复制链接」并提示粘贴到聊天窗口
 */

// 弹窗内容（分享图、各平台入口）第一次点开时才加载（见 blog-share-dialog.tsx）
const BlogShareDialog = dynamic(() => import('./blog-share-dialog').then(m => m.BlogShareDialog), { ssr: false })

export function BlogShare({ post }: { post: Pick<Post, 'id' | 'slug' | 'title' | 'description' | 'updatedAt'> }) {
  const t = useTranslations('Share')
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        className="gap-2 rounded-lg"
        aria-haspopup="dialog"
        aria-expanded={open}
        // 悬停 / 按下时先下载弹窗代码
        onPointerEnter={() => void import('./blog-share-dialog')}
        onClick={() => {
          setEverOpened(true)
          setOpen(true)
        }}
      >
        <ShareIcon />
        {t('share')}
      </Button>
      {everOpened && <BlogShareDialog post={post} open={open} onOpenChange={setOpen} />}
    </>
  )
}
