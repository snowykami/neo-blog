'use client'

import type { Post } from '@/models/post'
import { useTranslations } from 'next-intl'
import { parseAsInteger, useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { listPosts } from '@/api/post'
import { BlogCardGrid } from '@/components/blog-home/blog-home-card'
import { PaginationController } from '@/components/common/pagination'
import { useSiteInfo } from '@/contexts/site-info-context'
import { OrderBy } from '@/models/common'

/**
 * 用户主页的文章列表：按 userId 过滤，访客与他人只能看到公开文章（由后端控制）
 */
export function UserPosts({ userId }: { userId: number }) {
  const t = useTranslations('UserPage')
  const { siteInfo } = useSiteInfo()
  const pageSize = siteInfo.postsPerPage || 10
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [posts, setPosts] = useState<Post[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listPosts({ userId, page, size: pageSize, orderBy: OrderBy.CreatedAt, desc: true })
      .then((res) => {
        if (cancelled)
          return
        setPosts(res.data.posts || [])
        setTotal(res.data.total || 0)
      })
      .catch(() => {
        if (!cancelled) {
          setPosts([])
          setTotal(0)
        }
      })
      .finally(() => {
        if (!cancelled)
          setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, page, pageSize])

  return (
    <section className="grid gap-4 py-8">
      <h2 className="text-2xl font-bold">
        {t('posts')}
        {total > 0 && <span className="ml-2 text-lg font-normal text-muted-foreground">{`(${total})`}</span>}
      </h2>
      <BlogCardGrid posts={posts} showPrivate={true} isLoading={loading} />
      {total > 0 && (
        <PaginationController
          className="pt-4 flex justify-center"
          pageSize={pageSize}
          initialPage={page}
          total={total}
          onPageChange={(next) => {
            setPage(next)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      )}
    </section>
  )
}
