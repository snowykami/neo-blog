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
import { ListOidcConfigs, userLogin } from "@/api/user"
import Link from "next/link" // 使用 Next.js 的 Link 而不是 lucide 的 Link
import { useRouter, useSearchParams } from "next/navigation"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [oidcConfigs, setOidcConfigs] = useState<OidcConfig[]>([])
  const [{ username, password }, setCredentials] = useState({ username: '', password: '' })
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get("redirect_back") || "/"


  useEffect(() => {
    ListOidcConfigs()
      .then((res) => {
        setOidcConfigs(res.data.oidcConfigs || []) // 确保是数组
        console.log("OIDC configs fetched:", res.data.oidcConfigs)
      })
      .catch((error) => {
        console.error("Error fetching OIDC configs:", error)
        setOidcConfigs([]) // 错误时设置为空数组
      })
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await userLogin(username, password)
      console.log("Login successful:", res)
      router.push(redirectBack)
    } catch (error) {
      console.error("Login failed:", error)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>
            Login with Open ID Connect or your email and password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <div className="grid gap-6">
              {/* OIDC 登录选项 */}
              {oidcConfigs.length > 0 && (
                <div className="flex flex-col gap-4">
                  {oidcConfigs.map((config, index) => {
                    // 生成唯一的 key
                    const uniqueKey = config.id ||
                      config.loginUrl ||
                      `${config.displayName}-${index}` ||
                      `oidc-${index}`;

                    return (
                      <LoginWithOidc
                        key={uniqueKey}
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
                    Or continue with
                  </span>
                </div>
              )}

              {/* 邮箱密码登录 */}
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="email">Email or Username</Label>
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
                    <Label htmlFor="password">Password</Label>
                    <a
                      href="#"
                      className="ml-auto text-sm underline-offset-4 hover:underline"
                    >
                      Forgot your password?
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
                <Button type="submit" className="w-full" onClick={handleLogin}>
                  Login
                </Button>
              </div>

              {/* 注册链接 */}
              <div className="text-center text-sm">
                Don&apos;t have an account?{" "}
                <a href="#" className="underline underline-offset-4">
                  Sign up
                </a>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 服务条款 */}
      <div className="text-muted-foreground text-center text-xs text-balance">
        By clicking continue, you agree to our{" "}
        <a href="#" className="underline underline-offset-4 hover:text-primary">
          Terms of Service
        </a>{" "}
        and{" "}
        <a href="#" className="underline underline-offset-4 hover:text-primary">
          Privacy Policy
        </a>.
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