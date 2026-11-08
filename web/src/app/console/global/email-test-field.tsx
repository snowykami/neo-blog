'use client'

import type { ConfigValues } from './config-fields'
import { MailIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { sendTestEmail } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/auth-context'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'

/**
 * 发送测试邮件：取表单里当前填写的 SMTP 配置（没改的项由后端取已保存的配置）发一封测试邮件，
 * 因此填完不用先保存就能验证配置是否可用
 */
export function EmailTestField() {
  const t = useTranslations('Console.global')
  const errorMessageT = useErrorMessageT()
  const { user } = useAuth()
  const { getValues } = useFormContext<ConfigValues>()
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean, text: string } | null>(null)

  // 监听而不是直接读：改了服务器地址后按钮的可用状态要跟着变
  const host = String(useWatch<ConfigValues>({ name: 'email_host' }) ?? '').trim()
  const fromAddress = String(useWatch<ConfigValues>({ name: 'email_address' }) ?? '')

  const send = async () => {
    setSending(true)
    setResult(null)
    try {
      const res = await sendTestEmail({
        host,
        port: Number(getValues('email_port')) || 0,
        ssl: Boolean(getValues('email_ssl')),
        username: String(getValues('email_username') ?? ''),
        password: String(getValues('email_password') ?? ''),
        address: String(getValues('email_address') ?? ''),
        to: to.trim(),
      })
      const text = t('email_test_success', { email: res.data.to })
      setResult({ ok: true, text })
      toast.success(text)
    }
    catch (error) {
      const text = errorMessageT(error, t('email_test_failed'))
      setResult({ ok: false, text })
      toast.error(text)
    }
    finally {
      setSending(false)
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border border-dashed p-3 md:col-span-2">
      <div className="grid gap-1">
        <span className="text-sm leading-none font-medium">{t('email_test')}</span>
        <span className="text-xs text-muted-foreground">{t('email_test_desc')}</span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor="email-test-to" className="text-xs text-muted-foreground">{t('email_test_to')}</Label>
          <Input
            id="email-test-to"
            type="email"
            autoComplete="off"
            placeholder={fromAddress || user?.email || 'noreply@example.com'}
            value={to}
            onChange={e => setTo(e.target.value)}
          />
        </div>
        <Button type="button" variant="outline" disabled={sending || !host} onClick={() => void send()}>
          {sending ? <Spinner /> : <MailIcon />}
          {sending ? t('email_test_sending') : t('email_test_send')}
        </Button>
      </div>
      {!host && <p className="text-xs text-muted-foreground">{t('email_test_missing_host')}</p>}
      {result && (
        <p role="status" className={cn('text-xs', result.ok ? 'text-emerald-600 dark:text-emerald-500' : 'text-destructive')}>
          {result.text}
        </p>
      )}
    </div>
  )
}
