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
import Image from "next/image"
import { useState } from "react"
import { requestEmailVerifyCode, resetPassword } from "@/api/user"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { InputOTPControlled } from "@/components/common/input-otp"
import { BaseErrorResponse } from "@/models/resp"
import { loginPath, useToLogin } from "@/hooks/use-route"
import router from "next/router"

export function ResetPasswordForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const t = useTranslations('ResetPassword')
  const toLogin = useToLogin();
  const [email, setEmail] = useState("")
  const [verifyCode, setVerifyCode] = useState("")
  const [newPassword, setNewPassword] = useState("")

  const handleSendVerifyCode = () => {
    requestEmailVerifyCode(email)
      .then(() => {
        toast.success(t("send_verify_code_success"))
      })
      .catch((error: BaseErrorResponse) => {
        toast.error(`${t("send_verify_code_failed")}: ${error.response.data.message}`)
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
                  <Label htmlFor="email">{t("email")}</Label>
                  <div className="flex gap-3">
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    <Button
                      disabled={!email}
                      variant="outline"
                      className="border-2"
                      type="button"
                      onClick={handleSendVerifyCode}>{t("send_verify_code")}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="verify_code">{t("verify_code")}</Label>
                  <InputOTPControlled onChange={value => setVerifyCode(value)} />
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