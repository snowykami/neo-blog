'use client'

import type { CaptchaProps } from '@/types/captcha'
import HCaptcha from '@hcaptcha/react-hcaptcha'

export function HCaptchaWidget(props: CaptchaProps) {
  return (
    <HCaptcha
      sitekey={props.siteKey}
      onVerify={props.onSuccess}
      onError={props.onError}
      onExpire={() => props.onError?.('Captcha expired')}
    />
  )
}
