'use client'

import type { AdminUserDetail } from '@/api/admin'
import type { User } from '@/models/user'
import { Loader2 } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import {
  createUserAdmin,
  getUserAdmin,
  resetUserPasswordAdmin,
  updateUserAdmin,
  updateUserRoleAdmin,
} from '@/api/admin'
import { UserAvatar } from '@/components/common/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useCommonT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Role } from '@/models/user'

// 与后端 internal/service/admin_user.go 的校验保持一致
const USERNAME_MAX = 20
const NICKNAME_MAX = 20
const PASSWORD_MIN = 8
const PASSWORD_MAX = 32
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/
const URL_PATTERN = /^https?:\/\/\S+$/i
export const ROLES = [Role.ADMIN, Role.EDITOR, Role.USER] as const

export function displayName(user: User) {
  return user.nickname || user.username
}

function useUserFieldRules() {
  const t = useTranslations('Console.users')
  const commonT = useCommonT()
  return {
    username: {
      validate: (v: string) => {
        const value = v.trim()
        if (!value)
          return t('required', { field: commonT('username') })
        if (value.length > USERNAME_MAX || /[\s/@]/.test(value))
          return t('invalid_username', { max: USERNAME_MAX })
        return true
      },
    },
    nickname: {
      validate: (v: string) => v.trim().length <= NICKNAME_MAX || t('too_long', { field: t('nickname'), max: NICKNAME_MAX }),
    },
    email: {
      validate: (v: string) => EMAIL_PATTERN.test(v.trim()) || t('invalid_email'),
    },
    url: {
      validate: (v: string) => !v.trim() || URL_PATTERN.test(v.trim()) || t('invalid_url'),
    },
    password: {
      validate: (v: string) => (v.length >= PASSWORD_MIN && v.length <= PASSWORD_MAX) || t('password_hint', { min: PASSWORD_MIN, max: PASSWORD_MAX }),
    },
  }
}

function SubmitButton({ submitting, label }: { submitting: boolean, label: string }) {
  return (
    <Button type="submit" disabled={submitting}>
      {submitting && <Loader2 className="size-4 animate-spin" />}
      {label}
    </Button>
  )
}

function RoleSelect({ value, onChange }: { value: Role, onChange: (role: Role) => void }) {
  const roleT = useTranslations('Role')
  return (
    <Select value={value} onValueChange={v => onChange(v as Role)}>
      <FormControl>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        {ROLES.map(role => (
          <SelectItem key={role} value={role}>{roleT(role)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface CreateUserForm {
  username: string
  nickname: string
  email: string
  password: string
  role: Role
}

export function CreateUserDialog({ open, onOpenChange, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const t = useTranslations('Console.users')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('create')}</DialogTitle>
          <DialogDescription>{t('create_description')}</DialogDescription>
        </DialogHeader>
        {open && <CreateUserFormBody onCancel={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function CreateUserFormBody({ onCancel, onSaved }: { onCancel: () => void, onSaved: () => void }) {
  const t = useTranslations('Console.users')
  const commonT = useCommonT()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const rules = useUserFieldRules()
  const form = useForm<CreateUserForm>({
    defaultValues: { username: '', nickname: '', email: '', password: '', role: Role.USER },
  })

  const onSubmit = async (values: CreateUserForm) => {
    try {
      await createUserAdmin({
        ...values,
        username: values.username.trim(),
        nickname: values.nickname.trim(),
        email: values.email.trim(),
      })
      toast.success(operationT('create_success'))
      onSaved()
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('create_failed')))
    }
  }

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="username"
            rules={rules.username}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{commonT('username')}</FormLabel>
                <FormControl><Input {...field} autoComplete="off" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="nickname"
            rules={rules.nickname}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('nickname')}</FormLabel>
                <FormControl><Input {...field} autoComplete="off" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="email"
          rules={rules.email}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{commonT('email')}</FormLabel>
              <FormControl><Input {...field} type="email" autoComplete="off" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="password"
            rules={rules.password}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{commonT('password')}</FormLabel>
                <FormControl><Input {...field} type="password" autoComplete="new-password" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('role')}</FormLabel>
                <RoleSelect value={field.value} onChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{operationT('cancel')}</Button>
          <SubmitButton submitting={form.formState.isSubmitting} label={operationT('create')} />
        </DialogFooter>
      </form>
    </Form>
  )
}

interface EditUserForm {
  username: string
  nickname: string
  email: string
  avatarUrl: string
  backgroundUrl: string
  gender: string
}

export function EditUserDialog({ user, onOpenChange, onSaved }: {
  user: User | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const t = useTranslations('Console.users')
  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('edit')}</DialogTitle>
          {user && <DialogDescription>{displayName(user)}</DialogDescription>}
        </DialogHeader>
        {user && <EditUserFormBody user={user} onCancel={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function EditUserFormBody({ user, onCancel, onSaved }: { user: User, onCancel: () => void, onSaved: () => void }) {
  const t = useTranslations('Console.users')
  const commonT = useCommonT()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const rules = useUserFieldRules()
  const form = useForm<EditUserForm>({
    defaultValues: {
      username: user.username,
      nickname: user.nickname ?? '',
      email: user.email ?? '',
      avatarUrl: user.avatarUrl ?? '',
      backgroundUrl: user.backgroundUrl ?? '',
      gender: user.gender ?? '',
    },
  })
  const avatarUrl = form.watch('avatarUrl')

  const onSubmit = async (values: EditUserForm) => {
    try {
      await updateUserAdmin({
        id: user.id,
        username: values.username.trim(),
        nickname: values.nickname.trim(),
        email: values.email.trim(),
        avatarUrl: values.avatarUrl.trim(),
        backgroundUrl: values.backgroundUrl.trim(),
        gender: values.gender.trim(),
      })
      toast.success(operationT('update_success'))
      onSaved()
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('update_failed')))
    }
  }

  const textField = (name: keyof EditUserForm, label: string, rule?: { validate: (v: string) => string | true }, type?: string) => (
    <FormField
      control={form.control}
      name={name}
      rules={rule}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl><Input {...field} type={type} autoComplete="off" /></FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex items-center gap-3">
          <UserAvatar user={{ ...user, avatarUrl: avatarUrl.trim() || undefined }} size={96} className="size-12" />
          <div className="text-sm text-muted-foreground">{t('avatar_hint')}</div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {textField('username', commonT('username'), rules.username)}
          {textField('nickname', t('nickname'), rules.nickname)}
        </div>
        {textField('email', commonT('email'), rules.email, 'email')}
        {textField('avatarUrl', t('avatar_url'), rules.url)}
        {textField('backgroundUrl', t('background_url'), rules.url)}
        {textField('gender', t('gender'))}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{operationT('cancel')}</Button>
          <SubmitButton submitting={form.formState.isSubmitting} label={operationT('save')} />
        </DialogFooter>
      </form>
    </Form>
  )
}

export function ChangeRoleDialog({ user, onOpenChange, onSaved }: {
  user: User | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const t = useTranslations('Console.users')
  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('change_role')}</DialogTitle>
          {user && <DialogDescription>{t('change_role_description', { name: displayName(user) })}</DialogDescription>}
        </DialogHeader>
        {user && <ChangeRoleFormBody user={user} onCancel={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function ChangeRoleFormBody({ user, onCancel, onSaved }: { user: User, onCancel: () => void, onSaved: () => void }) {
  const t = useTranslations('Console.users')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const form = useForm<{ role: Role }>({ defaultValues: { role: user.role } })

  const onSubmit = async ({ role }: { role: Role }) => {
    try {
      await updateUserRoleAdmin(user.id, role)
      toast.success(operationT('update_success'))
      onSaved()
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('update_failed')))
    }
  }

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('role')}</FormLabel>
              <RoleSelect value={field.value} onChange={field.onChange} />
              <FormDescription>{t('role_hint')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{operationT('cancel')}</Button>
          <SubmitButton submitting={form.formState.isSubmitting} label={operationT('save')} />
        </DialogFooter>
      </form>
    </Form>
  )
}

interface ResetPasswordForm {
  newPassword: string
  confirmPassword: string
}

export function ResetPasswordDialog({ user, onOpenChange }: {
  user: User | null
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('Console.users')
  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('reset_password')}</DialogTitle>
          {user && <DialogDescription>{t('reset_password_description', { name: displayName(user) })}</DialogDescription>}
        </DialogHeader>
        {user && <ResetPasswordFormBody user={user} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordFormBody({ user, onDone }: { user: User, onDone: () => void }) {
  const t = useTranslations('Console.users')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const rules = useUserFieldRules()
  const form = useForm<ResetPasswordForm>({ defaultValues: { newPassword: '', confirmPassword: '' } })

  const onSubmit = async ({ newPassword }: ResetPasswordForm) => {
    try {
      await resetUserPasswordAdmin(user.id, newPassword)
      toast.success(operationT('update_success'))
      onDone()
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('update_failed')))
    }
  }

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="newPassword"
          rules={rules.password}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('new_password')}</FormLabel>
              <FormControl><Input {...field} type="password" autoComplete="new-password" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          rules={{ validate: v => v === form.getValues('newPassword') || t('password_mismatch') }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('confirm_password')}</FormLabel>
              <FormControl><Input {...field} type="password" autoComplete="new-password" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>{operationT('cancel')}</Button>
          <SubmitButton submitting={form.formState.isSubmitting} label={t('reset_password')} />
        </DialogFooter>
      </form>
    </Form>
  )
}

// 拉取用户详情（含内容统计），用于详情面板与删除确认
export function useUserDetail(userId: number | null) {
  const errorMessageT = useErrorMessageT()
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId)
      return
    let cancelled = false
    getUserAdmin(userId)
      .then((res) => {
        if (!cancelled)
          setDetail(res.data)
      })
      .catch((err) => {
        if (!cancelled)
          setError(errorMessageT(err))
      })
    return () => {
      cancelled = true
      setDetail(null)
      setError(null)
    }
  }, [errorMessageT, userId])

  return { detail, error }
}

export function UserDetailSheet({ user, isSelf, onOpenChange }: {
  user: User | null
  isSelf: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('Console.users')
  const commonT = useCommonT()
  const roleT = useTranslations('Role')
  const format = useFormatter()
  const { detail, error } = useUserDetail(user?.id ?? null)
  const current = detail?.user ?? user

  const rows: [string, React.ReactNode][] = current
    ? [
        [commonT('id'), <span key="id" className="font-mono">{current.id}</span>],
        [commonT('username'), current.username],
        [t('nickname'), current.nickname || '-'],
        [commonT('email'), current.email || '-'],
        [t('gender'), current.gender || '-'],
        [t('role'), roleT(current.role)],
        [t('status'), current.disabled ? t('status_disabled') : t('status_active')],
        [commonT('created_at'), current.createdAt ? format.dateTime(new Date(current.createdAt), { dateStyle: 'medium', timeStyle: 'short' }) : '-'],
      ]
    : []

  return (
    <Sheet open={!!user} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('detail')}</SheetTitle>
          {current && <SheetDescription>{displayName(current)}</SheetDescription>}
        </SheetHeader>
        {current && (
          <div className="grid gap-4 px-4 pb-4">
            <div className="flex items-center gap-3">
              <UserAvatar user={current} size={128} className="size-16" />
              <div className="grid gap-1">
                <div className="font-medium">{displayName(current)}</div>
                <div className="flex gap-2">
                  <Badge variant="secondary">{roleT(current.role)}</Badge>
                  {current.disabled && <Badge variant="destructive">{t('status_disabled')}</Badge>}
                  {isSelf && <Badge variant="outline">{t('self')}</Badge>}
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="grid grid-cols-3 gap-3">
              {([
                ['post_count', detail?.postCount],
                ['page_count', detail?.pageCount],
                ['comment_count', detail?.commentCount],
              ] as const).map(([key, value]) => (
                <div key={key} className="grid gap-1 rounded-md border p-3 text-center">
                  {detail
                    ? <div className="text-lg font-semibold tabular-nums">{value}</div>
                    : <Skeleton className="mx-auto h-7 w-8" />}
                  <div className="text-xs text-muted-foreground">{t(key)}</div>
                </div>
              ))}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
