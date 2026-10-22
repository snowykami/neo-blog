'use client'

import type { User } from '@/models/user'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getUserByUsername } from '@/api/user'
import ErrorPage from '@/components/common/error-page'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { UserHeader } from '@/components/user/user-header'
import { UserPosts } from '@/components/user/user-posts'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { getErrorStatus } from '@/utils/common/error'

export function UserPage() {
  const { username } = useParams() as { username: string }
  const commonT = useCommonT()
  const operationT = useOperationT()
  const [user, setUser] = useState<User | null>(null)
  // 加载失败时记录状态码，避免页面一直停留在加载中
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    setUser(null)
    setErrorStatus(null)
    getUserByUsername(username)
      .then((res) => {
        if (cancelled)
          return
        if (res.data)
          setUser(res.data)
        else
          setErrorStatus(404)
      })
      .catch((err) => {
        if (!cancelled)
          setErrorStatus(getErrorStatus(err) ?? 500)
      })
    return () => {
      cancelled = true
    }
  }, [username])

  if (errorStatus) {
    return (
      <ErrorPage
        status={errorStatus}
        message={errorStatus === 404 ? commonT('not_found') : operationT('fetch_failed')}
      />
    )
  }

  if (!user) {
    return (
      <SiteShell>
        <div className="flex flex-col items-center gap-5 rounded-2xl bg-card p-6 md:flex-row md:gap-6 md:p-8" aria-busy="true">
          <Skeleton className="size-28 shrink-0 rounded-full md:size-32" />
          <div className="grid w-full max-w-sm gap-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-7 w-64" />
          </div>
        </div>
      </SiteShell>
    )
  }
  return (
    <SiteShell>
      <UserHeader user={user} />
      <UserPosts userId={user.id} />
    </SiteShell>
  )
}
