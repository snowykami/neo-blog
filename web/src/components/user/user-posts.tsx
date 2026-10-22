'use client'

import type { Post } from '@/models/post'
import { useTranslations } from 'next-intl'
import { parseAsInteger, useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { listPosts } from '@/api/post'
import { PostList } from '@/components/blog-home/post-list'
import { PaginationController } from '@/components/common/pagination'
import { SectionTitle } from '@/components/layout/site-shell'
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
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
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
          setLoadError(true)
        }
      })
      .finally(() => {
        if (!cancelled)
          setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, page, pageSize, reloadKey])

  return (
    <section className="grid gap-4">
      <SectionTitle className="mx-4 text-xl md:mx-2 md:text-2xl">
        {t('posts')}
        {total > 0 && <span className="ml-2 text-base font-medium text-foreground/50 tabular-nums">{total}</span>}
      </SectionTitle>
      <PostList
        posts={posts}
        showPrivate={true}
        showAuthor={false}
        isLoading={loading}
        skeletonCount={pageSize}
        error={loadError}
        onRetry={() => setReloadKey(k => k + 1)}
      />
      {total > 0 && (
        <PaginationController
          className="flex justify-center pt-2"
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
