'use client'

import type { NotificationPreferences, NotificationType } from '@/models/notification'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { unsubscribeAllNotifications, updateNotificationPreferences } from '@/api/notification'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { useErrorMessageT } from '@/hooks/use-translations'

// 偏好页上的站内开关按「分组」呈现：一个开关对应一组事件类型（线程活动并入回复）
const INAPP_GROUPS: { key: string, label: string, types: NotificationType[] }[] = [
  { key: 'comment', label: 'switch_comment', types: ['comment.created'] },
  { key: 'reply', label: 'switch_reply', types: ['comment.replied', 'comment.thread_replied'] },
  { key: 'like', label: 'switch_like', types: ['post.liked', 'comment.liked'] },
  { key: 'mention', label: 'switch_mention', types: ['comment.mentioned'] },
]

interface PreferencesFormValues {
  comment: boolean
  reply: boolean
  like: boolean
  mention: boolean
  aiInteractions: boolean
  email: boolean
}

/**
 * 通知偏好表单：站内三个开关 + AI 互动 + 邮件总开关 + 一键关闭邮件。
 * 站点没开放的类型不显示（用户只能关不能开），邮件开关受站点总开关与白名单约束
 */
export function NotificationPreferencesForm({ initial, token }: {
  initial: NotificationPreferences
  // 邮件里的免登录凭据：带 token 时保存请求也带上它
  token?: string
}) {
  const t = useTranslations('NotificationSettings')
  const errorMessageT = useErrorMessageT()
  const [saving, setSaving] = useState(false)
  const [preferences, setPreferences] = useState(initial)

  const form = useForm<PreferencesFormValues>({
    defaultValues: toFormValues(initial),
  })

  // 站点级范围变化（切换语言、重新拉取）时同步一次
  useEffect(() => {
    setPreferences(initial)
    form.reset(toFormValues(initial))
  }, [initial, form])

  const emailTypes = preferences.siteEmailTypes
  // 站点没开邮件时整块邮件设置都不显示，只留一句说明
  const emailAvailable = preferences.siteEmailEnabled && emailTypes.length > 0

  const submit = async (values: PreferencesFormValues) => {
    setSaving(true)
    try {
      const inapp = INAPP_GROUPS.filter(group => values[group.key as 'comment' | 'reply' | 'like' | 'mention'])
        .flatMap(group => group.types)
        .filter(type => preferences.availableTypes.includes(type))
      // 邮件只有一个总开关：打开即接受站点开放的全部类型，关闭即清空（用户只能关不能开）
      const res = await updateNotificationPreferences({
        inapp,
        email: values.email ? emailTypes : [],
        aiInteractions: values.aiInteractions,
        token,
      })
      setPreferences(res.data)
      form.reset(toFormValues(res.data))
      toast.success(t('saved'))
    }
    catch (error) {
      toast.error(`${t('save_failed')}: ${errorMessageT(error)}`)
    }
    finally {
      setSaving(false)
    }
  }

  const unsubscribeAll = async () => {
    setSaving(true)
    try {
      const res = await unsubscribeAllNotifications({ token })
      setPreferences(res.data)
      form.reset(toFormValues(res.data))
      toast.success(t('email_all_off'))
    }
    catch (error) {
      toast.error(`${t('save_failed')}: ${errorMessageT(error)}`)
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <FormProvider {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(submit)}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('inapp_title')}</CardTitle>
            <CardDescription>{t('inapp_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {INAPP_GROUPS.map((group) => {
              // 站点 / 用户都没开放这一组时不显示，避免出现点不动的开关
              if (!group.types.some(type => preferences.availableTypes.includes(type)))
                return null
              return (
                <FormField
                  key={group.key}
                  control={form.control}
                  name={group.key as 'comment' | 'reply' | 'like' | 'mention'}
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between gap-4">
                      <FormLabel className="font-normal">{t(group.label)}</FormLabel>
                      <FormControl>
                        <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )
            })}
            <FormField
              control={form.control}
              name="aiInteractions"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4">
                  <div className="grid gap-1">
                    <FormLabel className="font-normal">{t('switch_ai')}</FormLabel>
                    <p className="text-muted-foreground text-xs text-balance">{t('switch_ai_desc')}</p>
                  </div>
                  <FormControl>
                    <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('email_title')}</CardTitle>
            <CardDescription>
              {emailAvailable ? t('email_desc') : t('email_unavailable')}
            </CardDescription>
          </CardHeader>
          {emailAvailable && (
            <CardContent className="grid gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between gap-4">
                    <FormLabel className="font-normal">{t('email_switch')}</FormLabel>
                    <FormControl>
                      <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <p className="text-muted-foreground text-xs text-balance">{t('email_note')}</p>
              <p className="text-muted-foreground text-xs text-balance">
                {t('email_open_types', { types: emailTypes.map(type => t(`type_${type.replace('.', '_')}`)).join(t('list_separator')) })}
              </p>
              <div>
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void unsubscribeAll()}>
                  {t('email_all_off')}
                </Button>
              </div>
            </CardContent>
          )}
        </Card>

        <div>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </form>
    </FormProvider>
  )
}

function toFormValues(preferences: NotificationPreferences): PreferencesFormValues {
  const has = (types: NotificationType[]) => types.some(type => preferences.inapp.includes(type))
  return {
    comment: has(INAPP_GROUPS[0].types),
    reply: has(INAPP_GROUPS[1].types),
    like: has(INAPP_GROUPS[2].types),
    mention: has(INAPP_GROUPS[3].types),
    aiInteractions: preferences.aiInteractions,
    email: preferences.email.length > 0,
  }
}
