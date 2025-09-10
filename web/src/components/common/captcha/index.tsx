
"use client"
import { useEffect } from "react";
import { GoogleReCaptcha, GoogleReCaptchaProvider } from "react-google-recaptcha-v3";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { Turnstile } from "@marsidev/react-turnstile";
import { CaptchaProvider } from "@/models/captcha";
import "./captcha.css";
import { TurnstileWidget } from "./turnstile";


export type CaptchaProps = {
  provider: CaptchaProvider;
  siteKey: string;
  url?: string;
  onSuccess: (token: string) => void;
  onError: (error: string) => void;
  onAbort?: () => void;
};

export function ReCaptchaWidget(props: CaptchaProps) {
  return (
    <GoogleReCaptchaProvider reCaptchaKey={props.siteKey} useEnterprise={false}>
      <GoogleReCaptcha action="submit" onVerify={props.onSuccess} />
    </GoogleReCaptchaProvider>
  );
}

export function NoCaptchaWidget(props: CaptchaProps) {
  useEffect(() => {
    props.onSuccess("no-captcha");
  }, [props, props.onSuccess]);
  return null;
}

export function HCaptchaWidget(props: CaptchaProps) {
  return (
    <HCaptcha
      sitekey={props.siteKey}
      onVerify={props.onSuccess}
      onError={props.onError}
      onExpire={() => props.onError?.("Captcha expired")}
    />
  );
}



export default function AIOCaptchaWidget(props: CaptchaProps) {
  switch (props.provider) {
    case CaptchaProvider.HCAPTCHA:
      return <HCaptchaWidget {...props} />;
    case CaptchaProvider.RECAPTCHA:
      return <ReCaptchaWidget {...props} />;
    case CaptchaProvider.TURNSTILE:
      return <TurnstileWidget {...props} />;
    case CaptchaProvider.DISABLE:
      return <NoCaptchaWidget {...props} />;
    default:
      throw new Error(`Unsupported captcha provider: ${props.provider}`);
  }
}