import { useEffect, useState } from 'react'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'

/**
 * 验证码输入框
 * 传入 value 时为受控模式（父组件可清空），否则内部自管理
 */
export function InputOTPControlled({ value: controlledValue, onChange, id }: { value?: string, onChange: (value: string) => void, id?: string }) {
  const [innerValue, setInnerValue] = useState('')
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : innerValue
  useEffect(() => {
    if (!isControlled)
      onChange(innerValue)
  }, [innerValue, onChange, isControlled])
  return (
    <div className="space-y-2">
      <InputOTP
        id={id}
        maxLength={6}
        value={value}
        onChange={(v) => {
          if (isControlled)
            onChange(v)
          else
            setInnerValue(v)
        }}
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
