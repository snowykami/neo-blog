"use client"
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { useEffect, useState } from "react";

const VERIFY_CODE_COOL_DOWN = 60; // seconds

export function UserSecurityPage() {
  const [email, setEmail] = useState("")
  const [verifyCode, setVerifyCode] = useState("")
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const handleSubmitPassword = () => {

  }
  const handleSendVerifyCode = () => {
    console.log("send verify code to ", email)
  }
  const handleSubmitEmail = () => {
    console.log("submit email ", email, verifyCode)
  }
  return (
    <div>
      <div className="grid w-full max-w-sm items-center gap-3">
        <h1 className="text-2xl font-bold">
          密码设置
        </h1>
        <Label htmlFor="password">Old Password</Label>
        <Input id="password" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
        <Label htmlFor="password">New Password</Label>
        <Input id="password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <Button className="max-w-1/3 border-2" onClick={handleSubmitPassword}>Submit</Button>
      </div>
      <Separator className="my-4" />
      <div className="grid w-full max-w-sm items-center gap-3 py-4">
        <h1 className="text-2xl font-bold">
          邮箱设置
        </h1>
        <Label htmlFor="email">email</Label>
        <div className="flex gap-3">
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button variant="outline" className="border-2" onClick={handleSendVerifyCode}>发送验证码</Button>
        </div>
        <Label htmlFor="verify-code">verify code</Label>
        <div className="flex gap-3">
          <InputOTPControlled onChange={(value) => setVerifyCode(value)} />
          <Button className="border-2" onClick={handleSubmitEmail}>Submit</Button>
        </div>
      </div>
    </div>
  )
}

function InputOTPControlled({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("")
  useEffect(() => {
    onChange(value)
  }, [value, onChange])
  return (
    <div className="space-y-2">
      <InputOTP
        maxLength={6}
        value={value}
        onChange={(value) => setValue(value)}
      >
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </InputOTP>
    </div>
  )
}
