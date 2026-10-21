'use client'

import type { User } from '@/models/user'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getUserByUsername } from '@/api/user'
import ErrorPage from '@/components/common/error-page'
import { Skeleton } from '@/components/ui/skeleton'
import { UserHeader } from '@/components/user/user-header'
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
      <div className="flex flex-col md:flex-row items-center gap-6 p-4 md:h-60">
        <Skeleton className="w-40 h-40 md:w-48 md:h-48 rounded-full" />
        <div className="grid gap-3 w-full max-w-sm">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
    )
  }
  return (
    <div>
      <UserHeader user={user} />
    </div>
  )
}
