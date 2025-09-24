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
import { requestEmailVerifyCode, resetPassword } from "@/api/user"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { InputOTPControlled } from "@/components/common/input-otp"
import { BaseErrorResponse } from "@/models/resp"
import { loginPath } from "@/hooks/use-route"
import router from "next/router"

export function ResetPasswordForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const t = useTranslations('ResetPassword')
  const commonT = useTranslations('Common')
  const [email, setEmail] = useState("")
  const [verifyCode, setVerifyCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [coolDown, setCoolDown] = useState(0)
  const [sendingVerifyCode, setSendingVerifyCode] = useState(false)

  useEffect(() => {
    if (coolDown <= 0) return
    const id = setInterval(() => {
      setCoolDown(c => (c > 1 ? c - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [coolDown])

  const handleSendVerifyCode = () => {
    if (coolDown > 0 || !email || sendingVerifyCode) return
    setSendingVerifyCode(true)
    requestEmailVerifyCode({ email })
      .then(() => {
        toast.success(t("send_verify_code_success"))
      })
      .catch((error: BaseErrorResponse) => {
        toast.error(`${t("send_verify_code_failed")}: ${error.response.data.message}`)
      })
      .finally(() => {
        setSendingVerifyCode(false)
        setCoolDown(60)
      })
  }

  const handleResetPassword = () => {
    resetPassword({ email, newPassword, verifyCode }).then(() => {
      toast.success(t("reset_password_success"))
      router.push(loginPath);
    }).catch((error: BaseErrorResponse) => {
      toast.error(`${t("reset_password_failed")}: ${error.response.data.message}`)
    })
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form>
            <div className="grid gap-6">
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="password">{t("new_password")}</Label>
                  <Input id="password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="email">{commonT("email")}</Label>
                  <div className="flex gap-3">
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

                  </div>
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="verify_code">{t("verify_code")}</Label>
                  <div className="flex gap-3 justify-between">
                    <InputOTPControlled onChange={value => setVerifyCode(value)} />
                    <Button
                      disabled={!email || coolDown > 0}
                      variant="outline"
                      className="border-2"
                      type="button"
                      onClick={handleSendVerifyCode}>
                      {commonT("obtain")}{coolDown > 0 ? `(${coolDown})` : ""}
                    </Button>
                  </div>

                </div>
                <Button
                  type="button"
                  className="w-full"
                  disabled={!email || !newPassword || !verifyCode}
                  onClick={handleResetPassword}
                >
                  {t("title")}
                </Button>
              </div>

              {/* TODO 回归登录和注册链接 */}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 服务条款 */}
    </div>
  )
}