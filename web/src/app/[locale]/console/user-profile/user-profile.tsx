'use client'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { uploadFile } from '@/api/file'
import { updateUser } from '@/api/user'
import { AssetField } from '@/components/common/asset-picker'
import { ImageAvatar } from '@/components/common/avatar'
import { ImageCropper } from '@/components/common/image-cropper'
import { TimeZoneCombobox } from '@/components/common/time-zone-combobox'
import { FormFloatingSaveBar } from '@/components/console/common/floating-save-bar'
import { useUserFieldRules } from '@/components/console/users/user-profile-fields'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { GenderInput } from '@/components/user/gender-input'
import { useAuth } from '@/contexts/auth-context'
import { useBrowserTimeZone } from '@/hooks/use-browser-time-zone'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { getFileUri } from '@/utils/client/file'
import { getAvatarOrGravatarUrlFromUser } from '@/utils/common/gravatar'
import { isAdmin } from '@/utils/common/permission'
import { consolePath } from '@/utils/common/route'
import { isValidTimeZone } from '@/utils/common/time-zone'
import { getFallbackAvatarFromUsername, getFallbackAvatarStyle } from '@/utils/common/username'

const PICTURE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
const PICTURE_MAX_SIZE = 5 * 1024 * 1024

// 只有同源地址（站内文件）可以导出裁剪结果，外链图片不提供裁剪
function croppableUrl(url: string) {
  return url.startsWith('/') && !url.startsWith('//') ? url : null
}

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return url
}

interface FormValues {
  nickname: string
  username: string
  gender: string
  showIpLocation: boolean
  showLikes: boolean
  showLocalTime: boolean
  timeZone: string
}

export function UserProfilePage() {
  const t = useTranslations('Console.user_profile')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const rules = useUserFieldRules()
  const { user, refresh } = useAuth()

  const form = useForm<FormValues>({
    defaultValues: {
      nickname: user?.nickname ?? '',
      username: user?.username ?? '',
      gender: user?.gender ?? '',
      showIpLocation: user?.showIpLocation ?? true,
      showLikes: user?.showLikes ?? false,
      showLocalTime: user?.showLocalTime ?? false,
      timeZone: user?.timeZone ?? '',
    },
  })
  const showLocalTime = form.watch('showLocalTime')
  const browserTimeZone = useBrowserTimeZone()

  // 头像 / 背景图地址：从资产库选择、本地上传或手动填写；裁剪结果在提交时再上传
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [backgroundUrl, setBackgroundUrl] = useState(user?.backgroundUrl ?? '')
  const [avatarCropped, setAvatarCropped] = useState<File | null>(null)
  const [backgroundCropped, setBackgroundCropped] = useState<File | null>(null)
  const avatarCroppedUrl = useObjectUrl(avatarCropped)
  const backgroundCroppedUrl = useObjectUrl(backgroundCropped)
  const initializedUserIdRef = useRef<number | null>(user?.id ?? null)

  useEffect(() => {
    if (!user || initializedUserIdRef.current === user.id)
      return
    initializedUserIdRef.current = user.id
    form.reset({
      nickname: user.nickname ?? '',
      username: user.username ?? '',
      gender: user.gender ?? '',
      showIpLocation: user.showIpLocation ?? true,
      showLikes: user.showLikes ?? false,
      showLocalTime: user.showLocalTime ?? false,
      timeZone: user.timeZone ?? '',
    })
    setAvatarUrl(user.avatarUrl ?? '')
    setBackgroundUrl(user.backgroundUrl ?? '')
    setAvatarCropped(null)
    setBackgroundCropped(null)
  }, [form, user])

  const isProfileChanged = (): boolean => {
    if (!user)
      return false
    const values = form.getValues()
    return (
      values.nickname.trim() !== (user.nickname ?? '')
      || values.username.trim() !== (user.username ?? '')
      || values.gender.trim() !== (user.gender ?? '')
      || avatarUrl !== (user.avatarUrl ?? '')
      || backgroundUrl !== (user.backgroundUrl ?? '')
      || avatarCropped !== null
      || backgroundCropped !== null
      || values.showIpLocation !== user.showIpLocation
      || values.showLikes !== (user.showLikes ?? false)
      || values.showLocalTime !== (user.showLocalTime ?? false)
      || (values.showLocalTime && values.timeZone !== (user.timeZone ?? ''))
    )
  }

  if (!user)
    return null

  const mediaDirty = avatarUrl !== (user.avatarUrl ?? '')
    || backgroundUrl !== (user.backgroundUrl ?? '')
    || avatarCropped !== null
    || backgroundCropped !== null

  const handleReset = () => {
    form.reset({
      nickname: user.nickname ?? '',
      username: user.username ?? '',
      gender: user.gender ?? '',
      showIpLocation: user.showIpLocation ?? true,
      showLikes: user.showLikes ?? false,
      showLocalTime: user.showLocalTime ?? false,
      timeZone: user.timeZone ?? '',
    })
    setAvatarUrl(user.avatarUrl ?? '')
    setBackgroundUrl(user.backgroundUrl ?? '')
    setAvatarCropped(null)
    setBackgroundCropped(null)
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (!isProfileChanged()) {
      handleReset()
      toast.info(t('no_changes_made'))
      return
    }

    try {
      let nextAvatarUrl = avatarUrl
      let nextBackgroundUrl = backgroundUrl
      if (avatarCropped) {
        const resp = await uploadFile({ file: avatarCropped, name: avatarCropped.name })
        nextAvatarUrl = getFileUri(resp.data.id)
      }
      if (backgroundCropped) {
        const resp = await uploadFile({ file: backgroundCropped, name: backgroundCropped.name })
        nextBackgroundUrl = getFileUri(resp.data.id)
      }

      await updateUser({
        id: user.id,
        nickname: values.nickname.trim(),
        username: values.username.trim(),
        gender: values.gender.trim(),
        avatarUrl: nextAvatarUrl,
        backgroundUrl: nextBackgroundUrl,
        showIpLocation: values.showIpLocation,
        showLikes: values.showLikes,
        showLocalTime: values.showLocalTime,
        // 关闭时不再上报时区，后端会一并清空已保存的时区
        timeZone: values.showLocalTime ? values.timeZone : '',
      })

      setAvatarUrl(nextAvatarUrl)
      setBackgroundUrl(nextBackgroundUrl)
      setAvatarCropped(null)
      setBackgroundCropped(null)
      form.reset({
        ...values,
        nickname: values.nickname.trim(),
        username: values.username.trim(),
        gender: values.gender.trim(),
        timeZone: values.showLocalTime ? values.timeZone : '',
      })

      toast.success(operationT('update_success'))
      await refresh()
    }
    catch (error: unknown) {
      toast.error(`${t('failed_to_update_profile')}: ${errorMessageT(error)}`)
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid w-full max-w-2xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('public_profile')}</CardTitle>
            {isAdmin({ user }) && (
              <CardDescription>
                {t('owner_card_hint')}
                {' '}
                <Link href={`${consolePath.global}?tab=site#owner`} className="text-primary underline underline-offset-4 hover:opacity-80">
                  {t('owner_card_hint_link')}
                </Link>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-2">
                <Label htmlFor="picture">{t('picture')}</Label>
                <ImageAvatar
                  src={avatarCroppedUrl ?? getAvatarOrGravatarUrlFromUser({ user: { ...user, avatarUrl }, size: 256 })}
                  alt={form.getValues('nickname') || form.getValues('username')}
                  fallback={getFallbackAvatarFromUsername(form.getValues('nickname') || form.getValues('username'))}
                  className="size-32 rounded-xl border-2"
                  fallbackClassName="text-5xl font-semibold text-white"
                  fallbackStyle={getFallbackAvatarStyle(user?.username ?? '')}
                />
                <AssetField
                  id="picture"
                  value={avatarUrl}
                  onChange={(url) => {
                    setAvatarUrl(url)
                    setAvatarCropped(null)
                  }}
                  accept={PICTURE_ACCEPT}
                  preview={false}
                  pickerProps={{ title: t('picture'), maxSize: PICTURE_MAX_SIZE }}
                  actions={(
                    <ImageCropper
                      image={avatarCropped ?? croppableUrl(avatarUrl)}
                      onCropped={blob => setAvatarCropped(new File([blob], 'avatar.png', { type: blob.type }))}
                      initialAspect={1}
                      lockAspect={true}
                    />
                  )}
                />
              </div>

              <div className="grid content-start gap-2">
                <Label htmlFor="background">{t('background')}</Label>
                <Avatar className="h-32 w-full rounded-sm border-2">
                  <AvatarImage
                    className="rounded-none object-cover"
                    src={backgroundCroppedUrl ?? backgroundUrl}
                    alt={form.getValues('nickname') || form.getValues('username')}
                  />
                  <AvatarFallback className="rounded-none">{t('background')}</AvatarFallback>
                </Avatar>
                <AssetField
                  id="background"
                  value={backgroundUrl}
                  onChange={(url) => {
                    setBackgroundUrl(url)
                    setBackgroundCropped(null)
                  }}
                  accept={PICTURE_ACCEPT}
                  preview={false}
                  pickerProps={{ title: t('background'), maxSize: PICTURE_MAX_SIZE }}
                  actions={(
                    <ImageCropper
                      image={backgroundCropped ?? croppableUrl(backgroundUrl)}
                      onCropped={blob => setBackgroundCropped(new File([blob], 'background.png', { type: blob.type }))}
                      initialAspect={3}
                      lockAspect={false}
                    />
                  )}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="nickname"
                rules={rules.nickname}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('nickname')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="username"
                rules={rules.username}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('username')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="gender"
              rules={rules.gender}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('gender')}</FormLabel>
                  <FormControl>
                    <GenderInput {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('privacy_and_display')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="showIpLocation"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="grid gap-1">
                    <FormLabel>{t('show_ip_location')}</FormLabel>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="showLikes"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="grid gap-1">
                    <FormLabel>{t('show_likes')}</FormLabel>
                    <FormDescription>{t('show_likes_description')}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="showLocalTime"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="grid gap-1">
                    <FormLabel>{t('show_local_time')}</FormLabel>
                    <FormDescription>{t('show_local_time_description')}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(checked)
                        // 首次开启时默认使用浏览器所在的时区
                        if (checked && !form.getValues('timeZone') && isValidTimeZone(browserTimeZone))
                          form.setValue('timeZone', browserTimeZone)
                      }}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {showLocalTime && (
              <FormField
                control={form.control}
                name="timeZone"
                rules={{ validate: value => isValidTimeZone(value) || t('invalid_time_zone') }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('time_zone')}</FormLabel>
                    <FormControl>
                      <TimeZoneCombobox value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>

        <FormFloatingSaveBar extraDirty={mediaDirty} onReset={handleReset} />
      </form>
    </Form>
  )
}
