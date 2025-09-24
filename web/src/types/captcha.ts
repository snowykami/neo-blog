export enum CaptchaProvider {
  HCAPTCHA = "hcaptcha",
  MCAPTCHA = "mcaptcha",
  RECAPTCHA = "recaptcha",
  TURNSTILE = "turnstile",
  DISABLE = "disable",
}

export type CaptchaProps = {
  provider: CaptchaProvider;
  siteKey: string;
  url?: string;
  onSuccess: (token: string) => void;
  onError: (error: string) => void;
  onAbort?: () => void;
};