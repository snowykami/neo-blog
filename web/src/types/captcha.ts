export enum CaptchaProvider {
  HCAPTCHA = 'hcaptcha',
  MCAPTCHA = 'mcaptcha',
  RECAPTCHA = 'recaptcha',
  TURNSTILE = 'turnstile',
  DISABLE = 'disable',
}

export interface CaptchaProps {
  provider: CaptchaProvider
  siteKey: string
  url?: string
  onSuccess: (token: string) => void
  onError: (error: string) => void
  onAbort?: () => void
}
