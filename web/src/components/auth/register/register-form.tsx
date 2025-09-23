"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useEffect, useState } from "react"
import { getCaptchaConfig, requestEmailVerifyCode, userRegister } from "@/api/user"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import Captcha from "@/components/common/captcha"
import { CaptchaProvider } from "@/models/captcha"
import { toast } from "sonner"
import { CurrentLogged } from "@/components/auth/common/current-logged"
import { SectionDivider } from "@/components/common/section-divider"
import { InputOTPControlled } from "@/components/common/input-otp"
import { BaseErrorResponse } from "@/models/resp"
import { useAuth } from "@/contexts/auth-context"
import Link from "next/link"
import { loginPath } from "@/hooks/use-route"

export function RegisterForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { setUser } = useAuth();
  const t = useTranslations('Register')
  const commonT = useTranslations('Common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get("redirect_back") || "/"
  const [captchaProps, setCaptchaProps] = useState<{
    provider: CaptchaProvider
    siteKey: string
    url?: string
  } | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [isLogging, setIsLogging] = useState(false)
  const [refreshCaptchaKey, setRefreshCaptchaKey] = useState(0)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [verifyCode, setVerifyCode] = useState('')


  useEffect(() => {
    getCaptchaConfig()
      .then((res) => {
        setCaptchaProps(res.data)
      })
      .catch((error) => {
        toast.error(t("fetch_captcha_config_failed") + (error?.message ? `: ${error.message}` : ""))
        setCaptchaProps(null)
      })
  }, [refreshCaptchaKey, t])

  const handleCaptchaError = (error: string) => {
    toast.error(t("captcha_error") + (error ? `: ${error}` : ""));
    setTimeout(() => {
      setRefreshCaptchaKey(k => k + 1);
    }, 1500);
  }

  const handleSendVerifyCode = () => {
    requestEmailVerifyCode(email)
      .then(() => {
        toast.success(t("send_verify_code_success"))
      })
      .catch((error: BaseErrorResponse) => {
        toast.error(`${t("send_verify_code_failed")}: ${error.response.data.message}`)
      })
  }

  const handleRegister = () => {
    if (!username || !password || !email) {
      toast.error(t("please_fill_in_all_required_fields"));
      return;
    }
    if (!captchaToken) {
      toast.error(t("please_complete_captcha_verification"));
      return;
    }
    userRegister({ username, password, email, verifyCode, captchaToken })
      .then(res => {
        toast.success(t("register_success") + ` ${res.data.user.nickname || res.data.user.username}`);
        setUser(res.data.user);
        router.push(redirectBack)
      })
      .catch((error: BaseErrorResponse) => {
        toast.error(t("register_failed") + (error?.response?.data?.message ? `: ${error.response.data.message}` : ""))
        setRefreshCaptchaKey(k => k + 1)
        setCaptchaToken(null)
      })
      .finally(() => {
        setIsLogging(false)
      })
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CurrentLogged />
          <form>
            <div className="grid gap-4">
              <SectionDivider className="mt-0">{t("register_a_new_account")}</SectionDivider>

              <div className="grid gap-4">

                {/* 用户名 */}
                <div className="grid gap-3">
                  <div className="flex items-center">
                    <Label htmlFor="username">{commonT("username")}</Label>
                  </div>
                  <Input
                    id="username"
                    type="text"
                    required
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                  />
                </div>
                {/* 密码 */}
                <div className="grid gap-3">
                  <div className="flex items-center">
                    <Label htmlFor="password">{commonT("password")}</Label>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
                {/* 邮箱 */}
                <div className="grid gap-3">
                  <Label htmlFor="email">{commonT("email")}</Label>
                  <div className="flex gap-3">
                    <Input
                      id="email"
                      type="text"
                      placeholder="example@liteyuki.org"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                    />

                  </div>
                </div>
                {/* 邮箱验证码 */}
                <div className="grid gap-3">
                  <Label htmlFor="email">{commonT("verify_code")}</Label>
                  <div className="flex justify-between">
                    <InputOTPControlled
                      onChange={value => setVerifyCode(value)}
                    />
                    <Button onClick={handleSendVerifyCode} disabled={!email} variant="outline" className="border-2" type="button">
                      {commonT("send_verify_code")}
                    </Button>
                  </div>

                </div>
                {captchaProps &&
                  <div className="flex justify-center items-center w-full">
                    <Captcha {...captchaProps} onSuccess={setCaptchaToken} onError={handleCaptchaError} key={refreshCaptchaKey} />
                  </div>
                }
                <Button
                  type="button"
                  className="w-full"
                  onClick={handleRegister}
                  disabled={!captchaToken || isLogging || !username || !password || !email}
                >
                  {isLogging ? t("registering") : t("register")}
                </Button>
                {/* 注册链接 */}
                <div className="text-center text-sm">
                  {t("already_have_account")}{" "}
                  <Link href={loginPath + "?redirect_back=" + encodeURIComponent(redirectBack)} className="underline underline-offset-4">
                    {commonT("login")}
                  </Link>
                </div>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}