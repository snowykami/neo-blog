'use client'

import type { User } from '@/models/user'
import { useFormatter, useTranslations } from 'next-intl'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { listUsers } from '@/api/admin'
import { UserAvatar } from '@/components/common/avatar'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDevice } from '@/contexts/device-context'
import { useCommonT, useErrorMessageT } from '@/hooks/use-translations'
import { OrderBy } from '@/models/common'
import { Role } from '@/models/user'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10
const COLUMN_COUNT = 6
// 后端用户列表支持的排序字段（另有 id / username，前端 OrderBy 暂未定义）
const USER_ORDER_BYS = [OrderBy.CreatedAt, OrderBy.UpdatedAt]

const ROLE_BADGE_VARIANT: Record<Role, 'default' | 'secondary' | 'outline'> = {
  [Role.ADMIN]: 'default',
  [Role.EDITOR]: 'secondary',
  [Role.USER]: 'outline',
}

// 管理员用户列表（权限由控制台布局统一校验，仅管理员可进入）
export function UserManagePage() {
  const t = useTranslations('Console.users')
  const format = useFormatter()
  const commonT = useCommonT()
  const roleT = useTranslations('Role')
  const metricsT = useTranslations('Metrics')
  const errorMessageT = useErrorMessageT()
  const { isMobile } = useDevice()
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orderBy, setOrderBy] = useQueryState(
    'order_by',
    parseAsStringEnum<OrderBy>(USER_ORDER_BYS)
      .withDefault(OrderBy.CreatedAt)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [desc, setDesc] = useQueryState(
    'desc',
    parseAsBoolean.withDefault(true).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [size, setSize] = useQueryState(
    'size',
    parseAsInteger
      .withDefault(isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listUsers({ page, size, orderBy, desc })
      setUsers(res.data.users || [])
      setTotal(res.data.total)
    }
    catch (err) {
      setError(errorMessageT(err))
    }
    finally {
      setLoading(false)
    }
  }, [desc, errorMessageT, orderBy, page, size])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const onOrderChange = useCallback(
    ({ orderBy, desc }: { orderBy: OrderBy, desc: boolean }) => {
      setOrderBy(orderBy)
      setDesc(desc)
      setPage(1)
    },
    [setOrderBy, setDesc, setPage],
  )

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground tabular-nums">
          {t('total', { total })}
        </div>
        <OrderSelector
          value={{ orderBy, desc }}
          onOrderChange={onOrderChange}
          orderBys={USER_ORDER_BYS}
        />
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{commonT('username')}</TableHead>
              <TableHead>{t('nickname')}</TableHead>
              <TableHead>{commonT('email')}</TableHead>
              <TableHead>{t('role')}</TableHead>
              <TableHead>{commonT('created_at')}</TableHead>
              <TableHead className="text-right">{commonT('id')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && Array.from({ length: 5 }, (_, i) => (
              <TableRow key={`skeleton-${i}`}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-8 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                <TableCell><Skeleton className="h-5 w-14" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="ml-auto h-4 w-8" /></TableCell>
              </TableRow>
            ))}
            {!loading && error && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center">
                  <div className="grid justify-items-center gap-3">
                    <p role="alert" className="text-sm text-destructive">
                      {t('load_failed')}
                      {error && `: ${error}`}
                    </p>
                    <Button size="sm" variant="outline" onClick={fetchUsers}>{t('retry')}</Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading && !error && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-muted-foreground">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {!loading && !error && users.map(user => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <UserAvatar user={user} size={64} className="size-8" fallbackClassName="text-xs" />
                    <span className="truncate font-medium">{user.username}</span>
                  </div>
                </TableCell>
                <TableCell className="max-w-48 truncate">{user.nickname || '-'}</TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground">{user.email || '-'}</TableCell>
                <TableCell>
                  <Badge variant={ROLE_BADGE_VARIANT[user.role] ?? 'outline'}>
                    {Object.values(Role).includes(user.role) ? roleT(user.role) : user.role}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {user.createdAt ? format.dateTime(new Date(user.createdAt), { dateStyle: 'medium' }) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {user.id}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-center gap-3">
        {total > 0 && (
          <PaginationController
            page={page}
            onPageChange={setPage}
            total={total}
            pageSize={size}
          />
        )}
        <div className="flex items-center gap-1 text-sm">
          <PageSizeSelector
            size={size}
            onSizeChange={(nextSize) => {
              setSize(nextSize)
              setPage(1)
            }}
          />
          {metricsT('per_page')}
        </div>
      </div>
    </div>
  )
}
