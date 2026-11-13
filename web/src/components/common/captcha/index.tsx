'use client'

import type { CaptchaProps } from '@/types/captcha'
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { CaptchaProvider } from '@/types/captcha'
import './captcha.css'

const HCaptchaWidget = dynamic(
  () => import('./hcaptcha').then(m => m.HCaptchaWidget),
  { ssr: false },
)

const ReCaptchaWidget = dynamic(
  () => import('./recaptcha').then(m => m.ReCaptchaWidget),
  { ssr: false },
)

const TurnstileWidget = dynamic(
  () => import('./turnstile').then(m => m.TurnstileWidget),
  { ssr: false },
)

export function NoCaptchaWidget(props: CaptchaProps) {
  const { onSuccess } = props
  useEffect(() => {
    onSuccess('no-captcha')
  }, [onSuccess])
  return null
}

export { HCaptchaWidget, ReCaptchaWidget, TurnstileWidget }

export default function AIOCaptchaWidget(props: CaptchaProps) {
  switch (props.provider) {
    case CaptchaProvider.HCAPTCHA:
      return <HCaptchaWidget {...props} />
    case CaptchaProvider.RECAPTCHA:
      return <ReCaptchaWidget {...props} />
    case CaptchaProvider.TURNSTILE:
      return <TurnstileWidget {...props} />
    case CaptchaProvider.DISABLE:
      return <NoCaptchaWidget {...props} />
    default:
      return <NoCaptchaWidget {...props} />
  }
}
