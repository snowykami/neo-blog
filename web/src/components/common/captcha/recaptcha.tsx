'use client'

import type { CaptchaProps } from '@/types/captcha'
import { GoogleReCaptcha, GoogleReCaptchaProvider } from 'react-google-recaptcha-v3'

export function ReCaptchaWidget(props: CaptchaProps) {
  return (
    <GoogleReCaptchaProvider reCaptchaKey={props.siteKey} useEnterprise={false}>
      <GoogleReCaptcha action="submit" onVerify={props.onSuccess} />
    </GoogleReCaptchaProvider>
  )
}
