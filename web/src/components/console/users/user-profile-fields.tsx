'use client'

import type { ReactNode } from 'react'
import type { ControllerRenderProps } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { useFormContext } from 'react-hook-form'
import { AssetField } from '@/components/common/asset-picker/asset-field'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useCommonT } from '@/hooks/use-translations'

// 与后端 internal/service/admin_user.go 的校验保持一致
export const USERNAME_MAX = 20
export const NICKNAME_MAX = 20
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 32
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/
// 外部 http(s) 地址，或站内文件的链接（/api/v1/file/...，从资产库选择或上传时得到）
const URL_PATTERN = /^(?:https?:\/\/|\/(?!\/))\S+$/i

export function isValidUsername(value: string) {
  return value.length > 0 && value.length <= USERNAME_MAX && !/[\s/@]/.test(value)
}

// 用户资料字段的校验规则：新建 / 编辑用户、新建 AI 用户共用
export function useUserFieldRules() {
  const t = useTranslations('Console.users')
  const commonT = useCommonT()
  return {
    username: {
      validate: (v: string) => {
        const value = v.trim()
        if (!value)
          return t('required', { field: commonT('username') })
        if (!isValidUsername(value))
          return t('invalid_username', { max: USERNAME_MAX })
        return true
      },
    },
    nickname: {
      validate: (v: string) => v.trim().length <= NICKNAME_MAX || t('too_long', { field: t('nickname'), max: NICKNAME_MAX }),
    },
    email: {
      validate: (v: string) => EMAIL_PATTERN.test(v.trim()) || t('invalid_email'),
    },
    url: {
      validate: (v: string) => !v.trim() || URL_PATTERN.test(v.trim()) || t('invalid_url'),
    },
    password: {
      validate: (v: string) => (v.length >= PASSWORD_MIN && v.length <= PASSWORD_MAX) || t('password_hint', { min: PASSWORD_MIN, max: PASSWORD_MAX }),
    },
  }
}

export interface UserProfileFieldValues {
  username: string
  nickname: string
  email: string
  avatarUrl: string
  backgroundUrl: string
  gender: string
}

export type UserProfileField = keyof UserProfileFieldValues

/**
 * 用户资料的表单字段，按固定顺序只渲染 fields 中列出的字段；头像、背景可粘贴地址，也可从资产库选择或上传。
 * 需放在 react-hook-form 的 <Form> 内，表单值需包含对应字段（见 UserProfileFieldValues）
 */
export function UserProfileFields({ fields, descriptions, placeholders }: {
  fields: UserProfileField[]
  descriptions?: Partial<Record<UserProfileField, ReactNode>>
  placeholders?: Partial<Record<UserProfileField, string>>
}) {
  const t = useTranslations('Console.users')
  const commonT = useCommonT()
  const rules = useUserFieldRules()
  const { control } = useFormContext<UserProfileFieldValues>()
  const has = (name: UserProfileField) => fields.includes(name)

  const field = (name: UserProfileField, label: string, rule: { validate: (v: string) => string | true } | undefined, renderControl: (input: ControllerRenderProps<UserProfileFieldValues, UserProfileField>) => ReactNode) => (
    <FormField
      control={control}
      name={name}
      rules={rule}
      render={({ field: input }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>{renderControl(input)}</FormControl>
          {descriptions?.[name] && <FormDescription>{descriptions[name]}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
  const text = (name: UserProfileField, label: string, rule?: { validate: (v: string) => string | true }, type?: string) =>
    field(name, label, rule, input => <Input {...input} type={type} autoComplete="off" placeholder={placeholders?.[name]} />)
  const asset = (name: UserProfileField, label: string, round: boolean) =>
    field(name, label, rules.url, input => (
      <AssetField {...input} autoComplete="off" placeholder={placeholders?.[name]} previewClassName={round ? 'rounded-full' : undefined} pickerProps={{ title: label }} />
    ))

  return (
    <>
      {(has('username') || has('nickname')) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {has('username') && text('username', commonT('username'), rules.username)}
          {has('nickname') && text('nickname', t('nickname'), rules.nickname)}
        </div>
      )}
      {has('email') && text('email', commonT('email'), rules.email, 'email')}
      {has('avatarUrl') && asset('avatarUrl', t('avatar_url'), true)}
      {has('backgroundUrl') && asset('backgroundUrl', t('background_url'), false)}
      {has('gender') && text('gender', t('gender'))}
    </>
  )
}
