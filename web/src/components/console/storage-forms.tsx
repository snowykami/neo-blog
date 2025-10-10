import type { StorageType } from '@/models/types'
import { useTranslations } from 'next-intl'
import React from 'react'
import { useFormContext } from 'react-hook-form'
import { Checkbox } from '@/components/ui/checkbox'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

export function S3Form() {
  const t = useTranslations('Console.storages')
  const { control } = useFormContext()

  const fields = [
    { name: 's3Region', label: 's3_region', type: 'input' },
    { name: 's3Bucket', label: 's3_bucket', type: 'input' },
    { name: 's3Prefix', label: 's3_prefix', type: 'input' },
    { name: 's3AccessKeyId', label: 's3_access_key_id', type: 'input' },
    { name: 's3SecretAccessKey', label: 's3_secret_access_key', type: 'input' },
    { name: 's3Endpoint', label: 's3_endpoint', type: 'input' },
    { name: 's3PathStyle', label: 's3_path_style', type: 'checkbox' },
    { name: 's3BaseUrl', label: 's3_base_url', type: 'input' },
  ] as const

  return (
    <>
      {fields.map(({ name, label, type }) => (
        <FormField
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t(label)}</FormLabel>
              <FormControl>{type === 'checkbox' ? <Checkbox {...field} /> : <Input {...field} />}</FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </>
  )
}

export function WebdavForm() {
  const t = useTranslations('Console.storages')
  const { control } = useFormContext()

  const fields = [
    { name: 'webdavEndpoint', label: 'webdav_endpoint' },
    { name: 'webdavUsername', label: 'webdav_username' },
    { name: 'webdavPassword', label: 'webdav_password' },
  ]
  return (
    <>
      {fields.map(({ name, label }) => (
        <FormField
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t(label)}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </>
  )
}

export function LocalForm() {
  return (
    <div>
    </div>
  )
}

// helper: 根据 type 返回组件
export const providerFormMap: Record<StorageType, React.ComponentType> = {
  local: LocalForm,
  s3: S3Form,
  webdav: WebdavForm,
  // ...other providers
}
