'use client'

import type { Post } from '@/models/post'
import { IconCreativeCommons } from '@tabler/icons-react'
import { CopyIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useOperationT } from '@/hooks/use-translations'
import copyToClipboard from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { getPostUrl, getUserUrl } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'

/**
 * 版权卡片（参考 Fuwari 的 License，MIT License, saicaca/fuwari）：
 * 标题 + 原文链接，作者 / 发布于 / 许可协议三栏，右侧浅色 CC 水印
 */
function CopyrightCard({ post, className }: { post: Post, className?: string }) {
  const { siteInfo } = useSiteInfo()
  const copyrightT = useTranslations('Copyright')
  const format = useFormatter()
  const operationT = useOperationT()
  const postUrl = siteInfo.baseUrl + getPostUrl({ post })
  const license = siteInfo.copyright || 'CC BY-NC-SA 4.0'
  const licenseLink = siteInfo.copyrightLink || 'https://creativecommons.org/licenses/by/4.0/'

  return (
    <section
      aria-label={copyrightT('copyright_notice')}
      className={cn('relative overflow-hidden rounded-xl bg-foreground/[.03] p-5', className)}
    >
      <IconCreativeCommons
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-6 size-60 -translate-y-1/2 text-foreground/5"
      />
      <div className="relative">
        <div className="font-bold text-foreground/75">{post.title}</div>
        <div className="flex items-center gap-1">
          <Link
            href={postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 break-all text-primary underline decoration-dashed underline-offset-4 hover:decoration-solid"
          >
            {postUrl}
          </Link>
          <Button
            onClick={() => {
              copyToClipboard(postUrl)
                .then(ok => ok ? toast.success(operationT('copy_link_success')) : toast.error(operationT('copy_link_failed')))
                .catch(() => toast.error(operationT('copy_link_failed')))
            }}
            size="icon-sm"
            variant="ghost"
            className="shrink-0 text-foreground/50"
            aria-label={operationT('copy_link')}
            title={operationT('copy_link')}
          >
            <CopyIcon aria-hidden />
          </Button>
        </div>

        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          <div className="min-w-0">
            <dt className="text-sm text-foreground/30">{copyrightT('author')}</dt>
            <dd>
              <Link
                href={getUserUrl(post.user)}
                className="block max-w-[20ch] truncate text-foreground/75 hover:text-primary"
                title={formatDisplayName(post.user)}
              >
                {formatDisplayName(post.user)}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-foreground/30">{copyrightT('post_at')}</dt>
            <dd className="whitespace-nowrap text-foreground/75 tabular-nums">
              {post.createdAt
                ? format.dateTime(new Date(post.createdAt), { year: 'numeric', month: '2-digit', day: '2-digit' })
                : copyrightT('unknown_date')}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-foreground/30">{copyrightT('license')}</dt>
            <dd>
              <Link
                href={licenseLink}
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap text-foreground/75 hover:text-primary"
              >
                {license}
              </Link>
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-sm text-foreground/50">
          {copyrightT('default_copyright', { license })}
        </p>
      </div>
    </section>
  )
}

export default CopyrightCard
