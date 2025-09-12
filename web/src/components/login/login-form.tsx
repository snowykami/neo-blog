"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Image from "next/image"
import { useEffect, useState } from "react"
import type { OidcConfig } from "@/models/oidc-config"
import { getCaptchaConfig, ListOidcConfigs, userLogin } from "@/api/user"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import Captcha from "../common/captcha"
import { CaptchaProvider } from "@/models/captcha"
import { toast } from "sonner"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const t = useTranslations('Login')
  const [oidcConfigs, setOidcConfigs] = useState<OidcConfig[]>([])
  const [captchaProps, setCaptchaProps] = useState<{
    provider: CaptchaProvider
    siteKey: string
    url?: string
  } | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaError, setCaptchaError] = useState<string | null>(null)
  const [isLogging, setIsLogging] = useState(false)
  const [refreshCaptchaKey, setRefreshCaptchaKey] = useState(0)
  const [{ username, password }, setCredentials] = useState({ username: '', password: '' })
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get("redirect_back") || "/"

  useEffect(() => {
    ListOidcConfigs()
      .then((res) => {
        setOidcConfigs(res.data || []) // 确保是数组
      })
      .catch((error) => {
        toast.error(t("fetch_oidc_configs_failed") + (error?.message ? `: ${error.message}` : ""))
        setOidcConfigs([]) // 错误时设置为空数组
      })
  }, [])

  useEffect(() => {
    getCaptchaConfig()
      .then((res) => {
        setCaptchaProps(res.data)
      })
      .catch((error) => {
        toast.error(t("fetch_captcha_config_failed") + (error?.message ? `: ${error.message}` : ""))
        setCaptchaProps(null)
      })
  }, [refreshCaptchaKey])

  const handleLogin = async (e: React.FormEvent) => {
    setIsLogging(true)
    e.preventDefault()
    userLogin({ username, password, captcha: captchaToken || "" })
      .then(res => {
        toast.success(t("login_success") + ` ${res.data.user.nickname || res.data.user.username}`);
        router.push(redirectBack)
      })
      .catch(error => {
        console.log(error)
        toast.error(t("login_failed") + (error?.response?.data?.message ? `: ${error.response.data.message}` : ""))
        setRefreshCaptchaKey(k => k + 1)
        setCaptchaToken(null)
      })
      .finally(() => {
        setIsLogging(false)
      })
  }

  const handleCaptchaError = (error: string) => {
    setCaptchaError(error);
    // 刷新验证码
    setTimeout(() => {
      setRefreshCaptchaKey(k => k + 1);
    }, 1500);
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{t("welcome")}</CardTitle>
          <CardDescription>
            {t("with_oidc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <div className="grid gap-6">
              {/* OIDC 登录选项 */}
              {oidcConfigs.length > 0 && (
                <div className="flex flex-col gap-4">
                  {oidcConfigs.map((config, index) => {
                    const uniqueKey = config.id ||
                      config.loginUrl ||
                      `${config.displayName}-${index}` ||
                      `oidc-${index}`;
                    return (
                      <LoginWithOidc
                        key={uniqueKey}
                        // 这个REDIRECT_BACK需要前端自己拼接，传给后端服务器，后端服务器拿来响应给前端另一个页面获取，然后改变路由   
                        // 因为这个是我暑假那会写的，后面因为其他事情太忙了，好久没看了，忘了为什么当时要这么设计了，在弄清楚之前先保持这样   
                        // 貌似是因为oidc认证时是后端响应重定向的，所以前端只能把redirect_back传给后端，由后端再传回来；普通登录时，这个参数可以被前端直接拿到进行路由跳转
                        loginUrl={config.loginUrl.replace("REDIRECT_BACK", encodeURIComponent(`?redirect_back=${redirectBack}`))}
                        displayName={config.displayName}
                        icon={config.icon}
                      />
                    );
                  })}
                </div>
              )}

              {/* 分隔线 */}
              {oidcConfigs.length > 0 && (
                <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                  <span className="bg-card text-muted-foreground relative z-10 px-2">
                    {t("or_continue_with_local_account")}
                  </span>
                </div>
              )}

              {/* 邮箱密码登录 */}
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="email">{t("email_or_username")}</Label>
                  <Input
                    id="email"
                    type="text"
                    placeholder="example@liteyuki.org"
                    required
                    value={username}
                    onChange={e => setCredentials(c => ({ ...c, username: e.target.value }))}
                  />
                </div>
                <div className="grid gap-3">
                  <div className="flex items-center">
                    <Label htmlFor="password">{t("password")}</Label>
                    <a
                      href="#"
                      className="ml-auto text-sm underline-offset-4 hover:underline"
                    >
                      {t("forgot_password")}
                    </a>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={e => setCredentials(c => ({ ...c, password: e.target.value }))}
                  />
                </div>
                {captchaProps &&
                  <div className="flex justify-center items-center w-full">
                    <Captcha {...captchaProps} onSuccess={setCaptchaToken} onError={handleCaptchaError} key={refreshCaptchaKey} />
                  </div>
                }
                <Button
                  type="submit"
                  className="w-full"
                  onClick={handleLogin}
                  disabled={!captchaToken || isLogging}
                >
                  {isLogging ? t("logging") : t("login")}
                </Button>
              </div>

              {/* 注册链接 */}
              <div className="text-center text-sm">
                {t("no_account")}{" "}
                <a href="#" className="underline underline-offset-4">
                  {t("register")}
                </a>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 服务条款 */}
      <div className="text-muted-foreground text-center text-xs text-balance">
        {t("by_logging_in_you_agree_to_our")}{" "}
        <a href="#" className="underline underline-offset-4 hover:text-primary">
          {t("terms_of_service")}
        </a>{" "}
        {t("and")}{" "}
        <a href="#" className="underline underline-offset-4 hover:text-primary">
          {t("privacy_policy")}
        </a>
      </div>
    </div>
  )
}

interface LoginWithOidcProps {
  loginUrl: string;
  displayName?: string;
  icon?: string;
}

function LoginWithOidc({
  loginUrl,
  displayName = "Login with OIDC",
  icon = "/oidc-icon.svg",
}: LoginWithOidcProps) {
  return (
    <Button
      variant="outline"
      className="w-full"
      asChild
    >
      <Link href={loginUrl}>
        <Image
          src={icon}
          alt={`${displayName} icon`}
          width={16}
          height={16}
          style={{
            width: '16px',
            height: '16px',
            marginRight: '8px'
          }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        {displayName}
      </Link>
    </Button>
  )
}