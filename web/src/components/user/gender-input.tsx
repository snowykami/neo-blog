'use client'

import type { ComponentProps } from 'react'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { GENDER_CUSTOM_MAX, GENDER_FEMALE, GENDER_MALE, isStandardGender } from '@/utils/common/gender'

const NONE = 'none'
const CUSTOM = 'custom'

/**
 * 性别输入，可直接放进 react-hook-form 的 <FormControl>：选「男」「女」时值为 male / female，
 * 选「自定义」时值为填写的文字，选「不填写」时为空。校验规则见 useUserFieldRules().gender
 */
export function GenderInput({ value, onChange, onBlur, disabled, className, ...props }: Omit<ComponentProps<typeof SelectTrigger>, 'value' | 'onChange' | 'onBlur' | 'children'> & {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
}) {
  const t = useTranslations('Gender')
  // 选了「自定义」后，文字清空或正好输入了 male 时仍保持自定义输入框
  const [customPicked, setCustomPicked] = useState(() => value !== '' && !isStandardGender(value))
  // 切到男 / 女后再切回自定义时，恢复之前填写的文字
  const lastCustom = useRef(isStandardGender(value) ? '' : value)
  const mode = customPicked ? CUSTOM : isStandardGender(value) ? value : value ? CUSTOM : NONE

  const onModeChange = (next: string) => {
    setCustomPicked(next === CUSTOM)
    if (next === CUSTOM)
      onChange(lastCustom.current)
    else
      onChange(isStandardGender(next) ? next : '')
  }

  return (
    <div className="grid gap-2">
      <Select value={mode} onValueChange={onModeChange} disabled={disabled}>
        <SelectTrigger {...props} onBlur={onBlur} className={cn('w-full', className)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('none')}</SelectItem>
          <SelectItem value={GENDER_MALE}>{t('male')}</SelectItem>
          <SelectItem value={GENDER_FEMALE}>{t('female')}</SelectItem>
          <SelectItem value={CUSTOM}>{t('custom')}</SelectItem>
        </SelectContent>
      </Select>
      {mode === CUSTOM && (
        <Input
          value={value}
          onChange={(e) => {
            lastCustom.current = e.target.value
            onChange(e.target.value)
          }}
          onBlur={onBlur}
          disabled={disabled}
          autoComplete="off"
          aria-label={t('custom_input')}
          aria-invalid={props['aria-invalid']}
          aria-describedby={props['aria-describedby']}
          placeholder={t('custom_placeholder', { max: GENDER_CUSTOM_MAX })}
        />
      )}
    </div>
  )
}
