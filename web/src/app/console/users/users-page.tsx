'use client'

import type { UserStatusFilter } from '@/api/admin'
import type { User } from '@/models/user'
import { Ban, CircleCheck, Eye, KeyRound, MoreHorizontal, Pencil, Plus, ShieldUser, Trash2 } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { deleteUserAdmin, listUsers, updateUserStatusAdmin } from '@/api/admin'
import { UserAvatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/contexts/auth-context'
import { useDevice } from '@/contexts/device-context'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useCommonT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { OrderBy } from '@/models/common'
import { Role } from '@/models/user'
import {
  ChangeRoleDialog,
  CreateUserDialog,
  displayName,
  EditUserDialog,
  ResetPasswordDialog,
  ROLES,
  UserDetailSheet,
  useUserDetail,
} from './user-dialogs'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10
const COLUMN_COUNT = 7
// 后端用户列表支持的排序字段（另有 id / username，前端 OrderBy 暂未定义）
const USER_ORDER_BYS = [OrderBy.CreatedAt, OrderBy.UpdatedAt]

const ROLE_BADGE_VARIANT: Record<Role, 'default' | 'secondary' | 'outline'> = {
  [Role.ADMIN]: 'default',
  [Role.EDITOR]: 'secondary',
  [Role.USER]: 'outline',
}

const ALL = 'all'
const USER_STATUSES: UserStatusFilter[] = ['active', 'disabled']

type DialogKind = 'detail' | 'edit' | 'role' | 'password' | 'status' | 'delete'

// 管理员用户管理（页面权限由控制台布局校验，所有操作均由后端 admin 中间件与服务层再次校验）
export function UserManagePage() {
  const t = useTranslations('Console.users')
  const format = useFormatter()
  const commonT = useCommonT()
  const roleT = useTranslations('Role')
  const metricsT = useTranslations('Metrics')
  const errorMessageT = useErrorMessageT()
  const operationT = useOperationT()
  const { user: currentUser } = useAuth()
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

  const [role, setRole] = useQueryState(
    'role',
    parseAsStringEnum<Role>([...ROLES]).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [status, setStatus] = useQueryState(
    'status',
    parseAsStringEnum<UserStatusFilter>(USER_STATUSES).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [keywordInput, setKeywordInput, keyword] = useDebouncedState('', 300)
  const [createOpen, setCreateOpen] = useState(false)
  const [dialog, setDialog] = useState<{ kind: DialogKind, user: User } | null>(null)
  const closeDialog = () => setDialog(null)
  const dialogUser = (kind: DialogKind) => (dialog?.kind === kind ? dialog.user : null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listUsers({
        page,
        size,
        orderBy,
        desc,
        keyword: keyword.trim(),
        role: role ?? '',
        status: status ?? '',
      })
      setUsers(res.data.users || [])
      setTotal(res.data.total)
    }
    catch (err) {
      setError(errorMessageT(err))
    }
    finally {
      setLoading(false)
    }
  }, [desc, errorMessageT, keyword, orderBy, page, role, size, status])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // 仅在搜索词真正变化时重置页码，避免挂载时把 URL 中的页码重置为 1
  const prevKeywordRef = useRef(keyword)
  useEffect(() => {
    if (prevKeywordRef.current === keyword)
      return
    prevKeywordRef.current = keyword
    setPage(1)
  }, [keyword, setPage])

  // 操作完成后刷新列表；删光当前页时回退到上一页
  const refreshAfterChange = async (removed = false) => {
    closeDialog()
    if (removed && users.length <= 1 && page > 1)
      await setPage(page - 1)
    else
      await fetchUsers()
  }

  const handleToggleStatus = async (user: User) => {
    await updateUserStatusAdmin(user.id, !user.disabled)
    toast.success(operationT('update_success'))
    await refreshAfterChange()
  }

  const handleDelete = async (user: User) => {
    await deleteUserAdmin(user.id)
    toast.success(operationT('delete_success'))
    await refreshAfterChange(true)
  }

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
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="w-full sm:w-64"
            type="search"
            placeholder={t('search_placeholder')}
            aria-label={t('search_placeholder')}
            value={keywordInput}
            onChange={e => setKeywordInput(e.target.value)}
          />
          <Select
            value={role ?? ALL}
            onValueChange={(v) => {
              setRole(v === ALL ? null : v as Role)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-32" aria-label={t('role')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('all_roles')}</SelectItem>
              {ROLES.map(r => <SelectItem key={r} value={r}>{roleT(r)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value={status ?? ALL}
            onValueChange={(v) => {
              setStatus(v === ALL ? null : v as UserStatusFilter)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-32" aria-label={t('status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('all_status')}</SelectItem>
              {USER_STATUSES.map(s => <SelectItem key={s} value={s}>{t(`status_${s}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <OrderSelector
            value={{ orderBy, desc }}
            onOrderChange={onOrderChange}
            orderBys={USER_ORDER_BYS}
          />
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t('create')}
          </Button>
        </div>
      </div>
      <div className="text-sm text-muted-foreground tabular-nums">
        {t('total', { total })}
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{commonT('username')}</TableHead>
              <TableHead>{t('nickname')}</TableHead>
              <TableHead>{commonT('email')}</TableHead>
              <TableHead>{t('role')}</TableHead>
              <TableHead>{t('status')}</TableHead>
              <TableHead>{commonT('created_at')}</TableHead>
              <TableHead className="text-right">{t('actions')}</TableHead>
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
                <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="ml-auto size-8" /></TableCell>
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
            {!loading && !error && users.map((user) => {
              const isSelf = currentUser?.id === user.id
              return (
                <TableRow key={user.id} className={user.disabled ? 'text-muted-foreground' : undefined}>
                  <TableCell>
                    <button
                      type="button"
                      className="flex items-center gap-3 text-left"
                      onClick={() => setDialog({ kind: 'detail', user })}
                    >
                      <UserAvatar user={user} size={64} className="size-8" fallbackClassName="text-xs" />
                      <span className="truncate font-medium hover:underline">{user.username}</span>
                      {isSelf && <Badge variant="outline">{t('self')}</Badge>}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-48 truncate">{user.nickname || '-'}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">{user.email || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={ROLE_BADGE_VARIANT[user.role] ?? 'outline'}>
                      {Object.values(Role).includes(user.role) ? roleT(user.role) : user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.disabled
                      ? <Badge variant="destructive">{t('status_disabled')}</Badge>
                      : <Badge variant="outline">{t('status_active')}</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {user.createdAt ? format.dateTime(new Date(user.createdAt), { dateStyle: 'medium' }) : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="size-8" aria-label={t('actions')}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'detail', user })}>
                          <Eye />
                          {t('detail')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', user })}>
                          <Pencil />
                          {t('edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={isSelf} onSelect={() => setDialog({ kind: 'role', user })}>
                          <ShieldUser />
                          {t('change_role')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'password', user })}>
                          <KeyRound />
                          {t('reset_password')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={isSelf} onSelect={() => setDialog({ kind: 'status', user })}>
                          {user.disabled ? <CircleCheck /> : <Ban />}
                          {user.disabled ? t('enable') : t('disable')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={isSelf}
                          onSelect={() => setDialog({ kind: 'delete', user })}
                        >
                          <Trash2 />
                          {t('delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
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

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          setCreateOpen(false)
          fetchUsers()
        }}
      />
      <UserDetailSheet
        user={dialogUser('detail')}
        isSelf={dialog?.user.id === currentUser?.id}
        onOpenChange={open => !open && closeDialog()}
      />
      <EditUserDialog user={dialogUser('edit')} onOpenChange={open => !open && closeDialog()} onSaved={() => refreshAfterChange()} />
      <ChangeRoleDialog user={dialogUser('role')} onOpenChange={open => !open && closeDialog()} onSaved={() => refreshAfterChange()} />
      <ResetPasswordDialog user={dialogUser('password')} onOpenChange={open => !open && closeDialog()} />
      {dialog?.kind === 'status' && (
        <ConfirmDialog
          open
          title={dialog.user.disabled
            ? t('enable_title', { name: displayName(dialog.user) })
            : t('disable_title', { name: displayName(dialog.user) })}
          description={dialog.user.disabled ? t('enable_description') : t('disable_description')}
          confirmLabel={dialog.user.disabled ? t('enable') : t('disable')}
          confirmVariant={dialog.user.disabled ? 'default' : 'destructive'}
          errorText={operationT('update_failed')}
          onOpenChange={open => !open && closeDialog()}
          onConfirm={() => handleToggleStatus(dialog.user)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteUserDialog
          user={dialog.user}
          onOpenChange={open => !open && closeDialog()}
          onConfirm={() => handleDelete(dialog.user)}
        />
      )}
    </div>
  )
}

// 删除确认：先拉取用户内容统计，明确告知文章、评论等的处理方式
function DeleteUserDialog({ user, onOpenChange, onConfirm }: {
  user: User
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}) {
  const t = useTranslations('Console.users')
  const operationT = useOperationT()
  const { detail, error } = useUserDetail(user.id)
  return (
    <ConfirmDialog
      open
      title={t('delete_title', { name: displayName(user) })}
      description={(
        <>
          {detail
            ? (
                <>
                  <p>{t('delete_transfer', { posts: detail.postCount, pages: detail.pageCount })}</p>
                  <p>{t('delete_remove', { comments: detail.commentCount })}</p>
                </>
              )
            : error
              ? <p className="text-destructive">{error}</p>
              : <Skeleton className="h-10 w-full" />}
          <p className="font-medium text-destructive">{t('delete_irreversible')}</p>
        </>
      )}
      confirmLabel={t('delete')}
      errorText={operationT('delete_failed')}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />
  )
}
