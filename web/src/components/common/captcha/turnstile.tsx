import type { CaptchaProps } from '@/types/captcha'
import { Turnstile } from '@marsidev/react-turnstile'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

const TURNSTILE_TIMEOUT = 15
// 简单的转圈圈动画
function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40 }}>
      <svg className="animate-spin" width="32" height="32" viewBox="0 0 50 50">
        <circle className="opacity-25" cx="25" cy="25" r="20" fill="none" stroke="#e5e7eb" strokeWidth="5" />
        <circle className="opacity-75" cx="25" cy="25" r="20" fill="none" stroke="#6366f1" strokeWidth="5" strokeDasharray="90 150" strokeDashoffset="0" />
      </svg>
    </div>
  )
}

// 勾勾动画
function CheckMark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40 }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 10 18 4 12" />
      </svg>
    </div>
  )
}

// 错误的叉
function ErrorMark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40 }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </div>
  )
}

export function OfficialTurnstileWidget(props: CaptchaProps) {
  return (
    <div>
      <Turnstile className="w-full" options={{ size: 'invisible' }} siteKey={props.siteKey} onSuccess={props.onSuccess} onError={props.onError} onAbort={props.onAbort} />
    </div>
  )
}

export function TurnstileWidget(props: CaptchaProps) {
  const t = useTranslations('Captcha')
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  const handleSuccess = (token: string) => {
    setStatus('success')
    return props.onSuccess && props.onSuccess(token)
  }

  const handleError = (error: string) => {
    setStatus('error')
    setError(error)
    return props.onError && props.onError(error)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (status === 'loading') {
        setStatus('error')
        setError('timeout')
        return props.onError && props.onError('timeout')
      }
    }, TURNSTILE_TIMEOUT * 1000)
    return () => clearTimeout(timer)
  }, [status, props])

  return (
    <div className="flex items-center justify-evenly w-full border border-gray-300 rounded-md px-4 py-2 relative">
      {status === 'loading' && <Spinner />}
      {status === 'success' && <CheckMark />}
      {status === 'error' && <ErrorMark />}
      <div className="flex-1 text-center">
        {status === 'success' ? t('success') : (status === 'error' ? t('error') : t('doing'))}
        {' '}
        {error && t(error)}
      </div>
      <div className="absolute inset-0 opacity-0 pointer-events-none">
        <OfficialTurnstileWidget {...props} onSuccess={handleSuccess} onError={handleError} />
      </div>
    </div>
  )
}
