'use client'

import { useTranslations } from 'next-intl'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { getAIWritingHabit, updateAIWritingHabit } from '@/api/ai-prompt'
import { InfoTooltip } from '@/components/common/info-tooltip'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'

// 与后端 aiWritingHabitMaxRune 一致
const MAX_HABIT = 2000

interface HabitFormValues {
  habit: string
}

/** 当前用户的 AI 写作语言习惯：AI 帮写、润色与 MCP 外部写作时参考；编辑器指令管理弹窗与个性化设置页共用 */
export function AIWritingHabitForm({ className }: { className?: string }) {
  const t = useTranslations('Console.editor.ai.habit')
  const errorMessageT = useErrorMessageT()
  // 加载成功前不允许保存，避免用空内容覆盖已有的习惯
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const form = useForm<HabitFormValues>({ defaultValues: { habit: '' } })

  React.useEffect(() => {
    let cancelled = false
    getAIWritingHabit()
      .then((res) => {
        if (cancelled)
          return
        form.reset({ habit: res.data?.habit ?? '' })
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled)
          return
        setStatus('error')
        toast.error(`${t('load_failed')}: ${errorMessageT(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [form, t, errorMessageT])

  const onSubmit = async (values: HabitFormValues) => {
    try {
      const res = await updateAIWritingHabit(values.habit.trim())
      form.reset({ habit: res.data?.habit ?? '' })
      toast.success(t('saved'))
    }
    catch (error) {
      toast.error(`${t('save_failed')}: ${errorMessageT(error)}`)
    }
  }

  return (
    <Form {...form}>
      <form className={cn('grid content-start gap-4', className)} onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="habit"
          rules={{ maxLength: { value: MAX_HABIT, message: t('too_long', { max: MAX_HABIT }) } }}
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-1">
                <FormLabel>{t('label')}</FormLabel>
                <InfoTooltip content={t('hint')} />
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{`${field.value.length}/${MAX_HABIT}`}</span>
              </div>
              <FormControl>
                <Textarea {...field} rows={8} maxLength={MAX_HABIT} disabled={status !== 'ready'} placeholder={t('placeholder')} className="max-h-[50dvh] resize-y" />
              </FormControl>
              <FormDescription>{t('description')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-3">
          <Button type="submit" disabled={status !== 'ready' || !form.formState.isDirty || form.formState.isSubmitting}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
