'use client'

import type { Post } from '@/models/post'
import { PinIcon, PinOffIcon, TriangleAlertIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { listPinnedPostsAdmin, setPostPin } from '@/api/admin'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useErrorMessageT } from '@/hooks/use-translations'
import { PINNED_POSTS_LIMIT } from '@/models/post'
import { getErrorBody } from '@/utils/common/error'

// 文章置顶（只有管理员可以操作）：首页最多 PINNED_POSTS_LIMIT 篇，后置顶的在前，可设到期时间。
// 置顶直接调用接口生效，不随草稿保存

export type PostPinState = Pick<Post, 'pinned' | 'pinnedAt' | 'pinnedUntil'>

export function pinStateOf(post: Pick<Post, 'pinned' | 'pinnedAt' | 'pinnedUntil'>): PostPinState {
  return {
    pinned: post.pinned,
    pinnedAt: post.pinnedAt,
    pinnedUntil: post.pinnedUntil,
  }
}

const isLimitError = (error: unknown) => getErrorBody(error)?.code === 'pinned_posts_limit'

/** 到期时间的文字，如「11月20日」；不设到期时为空 */
export function usePinUntilText() {
  const format = useFormatter()
  return (until: string | null) => (until ? format.dateTime(new Date(until), { month: 'short', day: 'numeric' }) : '')
}

/** 后台文章列表的置顶 / 取消置顶；首页已满时提示先取消一篇 */
export function usePostPinAction(post: Post, onChange: (state: PostPinState) => void) {
  const t = useTranslations('Console.post_edit')
  const errorMessageT = useErrorMessageT()
  return async () => {
    const pinned = !post.pinned
    try {
      const res = await setPostPin({ id: post.id, pinned })
      onChange(pinStateOf(res.data))
      toast.success(t(pinned ? 'pin_success' : 'unpin_success'))
    }
    catch (error) {
      toast.error(isLimitError(error) ? t('pin_limit_hint', { max: PINNED_POSTS_LIMIT }) : errorMessageT(error))
    }
  }
}

type ExpiryChoice = 'forever' | '7' | '30' | 'custom'

// 日期输入框的值（本地时区 yyyy-mm-dd）与对应当天 0 点的时间
const toDateInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
function fromDateInput(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const addDays = (days: number) => new Date(Date.now() + days * 86400_000)

interface PostPinFormValues {
  pinned: boolean
  choice: ExpiryChoice
  customDate: string
}

function toPinFormValues(state: PostPinState): PostPinFormValues {
  return {
    pinned: state.pinned,
    choice: state.pinnedUntil ? 'custom' : 'forever',
    customDate: state.pinnedUntil ? toDateInput(new Date(state.pinnedUntil)) : '',
  }
}

/** 文章设置里的置顶：开关、到期时间；首页已满时直接列出已置顶的文章，取消一篇后置顶本文 */
export function PostPinField({ postId, state, onChange }: { postId: number, state: PostPinState, onChange: (state: PostPinState) => void }) {
  const t = useTranslations('Console.post_edit')
  const format = useFormatter()
  const errorMessageT = useErrorMessageT()
  const [busy, setBusy] = useState(false)
  // 首页已满时列出的置顶文章
  const [occupied, setOccupied] = useState<Post[] | null>(null)
  const form = useForm<PostPinFormValues>({
    defaultValues: toPinFormValues(state),
  })
  const choice = useWatch({ control: form.control, name: 'choice' })

  useEffect(() => {
    form.reset({
      pinned: state.pinned,
      choice: state.pinnedUntil ? 'custom' : 'forever',
      customDate: state.pinnedUntil ? toDateInput(new Date(state.pinnedUntil)) : '',
    })
  }, [form, state.pinned, state.pinnedUntil])

  const apply = async (pinned: boolean, pinnedUntil: Date | null = null) => {
    setBusy(true)
    try {
      const res = await setPostPin({ id: postId, pinned, pinnedUntil: pinnedUntil?.toISOString() ?? null })
      onChange(pinStateOf(res.data))
      setOccupied(null)
      return true
    }
    catch (error) {
      if (isLimitError(error))
        setOccupied((await listPinnedPostsAdmin().catch(() => null))?.data.posts ?? [])
      else
        toast.error(errorMessageT(error))
      return false
    }
    finally {
      setBusy(false)
    }
  }

  const togglePinned = async (pinned: boolean) => {
    const ok = await apply(pinned)
    if (ok) {
      toast.success(t(pinned ? 'pin_success' : 'unpin_success'))
      if (!pinned)
        form.setValue('choice', 'forever')
    }
    else {
      form.setValue('pinned', state.pinned)
    }
  }

  const changeExpiry = (next: ExpiryChoice, date?: string) => {
    const fallbackDate = toDateInput(state.pinnedUntil ? new Date(state.pinnedUntil) : addDays(7))
    const resolvedDate = date || fallbackDate
    if (next === 'custom' && !date)
      form.setValue('customDate', resolvedDate)
    const until = next === 'forever'
      ? null
      : next === 'custom'
        ? fromDateInput(resolvedDate)
        : addDays(Number(next))
    void apply(true, until)
  }

  // 取消一篇已置顶的文章，再置顶本文
  const replace = async (other: Post) => {
    setBusy(true)
    try {
      await setPostPin({ id: other.id, pinned: false })
    }
    catch (error) {
      toast.error(errorMessageT(error))
      setBusy(false)
      return
    }
    if (await apply(true))
      toast.success(t('pin_replaced', { title: other.title }))
  }

  const until = state.pinnedUntil ? new Date(state.pinnedUntil) : null
  const minDate = toDateInput(addDays(1))
  return (
    <Form {...form}>
      <div className="grid min-w-0 gap-3 rounded-lg border p-3">
        <FormField
          control={form.control}
          name="pinned"
          render={({ field }) => (
            <FormItem className="flex items-start gap-3">
              <div className="grid flex-1 gap-0.5">
                <FormLabel className="flex items-center gap-1.5">
                  <PinIcon className="size-3.5 text-primary" aria-hidden />
                  {t('pin_to_home')}
                </FormLabel>
                <FormDescription className="text-xs">
                  {state.pinned && state.pinnedAt
                    ? t('pin_status', { date: format.dateTime(new Date(state.pinnedAt), { dateStyle: 'medium' }) })
                    : t('pin_hint', { max: PINNED_POSTS_LIMIT })}
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  disabled={busy}
                  onCheckedChange={(checked) => {
                    field.onChange(checked)
                    void togglePinned(checked)
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />

        {occupied && (
          <Alert>
            <TriangleAlertIcon className="text-amber-500" aria-hidden />
            <AlertTitle>{t('pin_limit_title', { max: PINNED_POSTS_LIMIT })}</AlertTitle>
            <AlertDescription className="min-w-0">
              <ul className="grid w-full min-w-0 gap-1.5">
                {occupied.map(post => (
                  <li key={post.id} className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate" title={post.title}>{post.title}</span>
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => replace(post)}>
                      <PinOffIcon aria-hidden />
                      {t('unpin_action')}
                    </Button>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {state.pinned && (
          <div className="grid gap-2 border-t border-dashed pt-3">
            <FormField
              control={form.control}
              name="choice"
              render={({ field }) => (
                <FormItem className="grid gap-2">
                  <FormLabel>{t('pin_expiry')}</FormLabel>
                  <FormControl>
                    <ToggleGroup
                      type="single"
                      variant="segmented"
                      size="sm"
                      value={field.value}
                      disabled={busy}
                      onValueChange={(value) => {
                        if (!value)
                          return
                        const next = value as ExpiryChoice
                        field.onChange(next)
                        changeExpiry(next, form.getValues('customDate') || undefined)
                      }}
                      aria-label={t('pin_expiry')}
                      className="w-full"
                    >
                      {/* 四段等宽，占满一行 */}
                      <ToggleGroupItem value="forever" className="flex-1 px-2">{t('pin_expiry_forever')}</ToggleGroupItem>
                      <ToggleGroupItem value="7" className="flex-1 px-2">{t('pin_expiry_days', { days: 7 })}</ToggleGroupItem>
                      <ToggleGroupItem value="30" className="flex-1 px-2">{t('pin_expiry_days', { days: 30 })}</ToggleGroupItem>
                      <ToggleGroupItem value="custom" className="flex-1 px-2">{t('pin_expiry_custom')}</ToggleGroupItem>
                    </ToggleGroup>
                  </FormControl>
                </FormItem>
              )}
            />
            {choice === 'custom' && (
              <FormField
                control={form.control}
                name="customDate"
                render={({ field }) => (
                  <FormItem className="grid gap-1">
                    <FormControl>
                      <Input
                        type="date"
                        className="w-auto justify-self-start"
                        min={minDate}
                        value={field.value}
                        disabled={busy}
                        aria-label={t('pin_expiry_custom')}
                        onChange={(e) => {
                          const v = e.target.value
                          field.onChange(v)
                          if (v && v >= minDate)
                            changeExpiry('custom', v)
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <span className="text-xs text-muted-foreground">
              {until
                ? t('pin_expiry_result', { date: format.dateTime(until, { dateStyle: 'long', timeStyle: 'short' }) })
                : t('pin_expiry_result_forever')}
            </span>
          </div>
        )}
      </div>
    </Form>
  )
}
