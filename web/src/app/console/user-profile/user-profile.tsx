'use client'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { uploadFile } from '@/api/file'
import { updateUser } from '@/api/user'
import { AssetField } from '@/components/common/asset-picker'
import { ImageAvatar } from '@/components/common/avatar'
import { ImageCropper } from '@/components/common/image-cropper'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/contexts/auth-context'
import { useErrorMessageT } from '@/hooks/use-translations'
import { localesData } from '@/locales'
import { getFileUri } from '@/utils/client/file'
import { getAvatarOrGravatarUrlFromUser } from '@/utils/common/gravatar'
import { getFallbackAvatarFromUsername } from '@/utils/common/username'

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
  language: string
  showIpLocation: boolean
}

export function UserProfilePage() {
  const t = useTranslations('Console.user_profile')
  const errorMessageT = useErrorMessageT()
  const { user } = useAuth()

  const form = useForm<FormValues>({
    defaultValues: {
      nickname: user?.nickname ?? '',
      username: user?.username ?? '',
      gender: user?.gender ?? '',
      language: user?.language ?? 'en',
      showIpLocation: user?.showIpLocation ?? true,
    },
  })

  // 头像 / 背景图地址：从资产库选择、本地上传或手动填写；裁剪结果在提交时再上传
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [backgroundUrl, setBackgroundUrl] = useState(user?.backgroundUrl ?? '')
  const [avatarCropped, setAvatarCropped] = useState<File | null>(null)
  const [backgroundCropped, setBackgroundCropped] = useState<File | null>(null)
  const avatarCroppedUrl = useObjectUrl(avatarCropped)
  const backgroundCroppedUrl = useObjectUrl(backgroundCropped)

  const isProfileChanged = (): boolean => {
    if (!user)
      return false
    const values = form.getValues()
    return (
      values.nickname.trim() !== (user.nickname ?? '')
      || values.username.trim() !== (user.username ?? '')
      || values.gender !== (user.gender ?? '')
      || values.language !== (user.language ?? '')
      || avatarUrl !== (user.avatarUrl ?? '')
      || backgroundUrl !== (user.backgroundUrl ?? '')
      || avatarCropped !== null
      || backgroundCropped !== null
      || values.showIpLocation !== user.showIpLocation
    )
  }

  if (!user)
    return null

  const onSubmit = form.handleSubmit(async (values) => {
    // check values nickname可为空
    if (values.username.trim() === '') {
      toast.error(t('nickname_and_username_cannot_be_empty'))
      return
    }
    if (values.username.length < 1 || values.username.length > 20 || values.nickname.length > 20) {
      toast.error(t('nickname_and_username_must_be_between', { min: 1, max: 20 }))
      return
    }

    if (!isProfileChanged()) {
      toast.warning(t('no_changes_made'))
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
        nickname: values.nickname,
        username: values.username,
        gender: values.gender,
        language: values.language,
        avatarUrl: nextAvatarUrl,
        backgroundUrl: nextBackgroundUrl,
        showIpLocation: values.showIpLocation,
      })
      window.location.reload()
    }
    catch (error: unknown) {
      toast.error(`${t('failed_to_update_profile')}: ${errorMessageT(error)}`)
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid w-full max-w-sm items-center gap-4">
        <h1 className="text-2xl font-bold">{t('public_profile')}</h1>

        <div className="grid w-full items-center gap-4">
          <div className="grid gap-2">
            <Label htmlFor="picture">{t('picture')}</Label>
            <ImageAvatar
              src={avatarCroppedUrl ?? getAvatarOrGravatarUrlFromUser({ user: { ...user, avatarUrl }, size: 256 })}
              alt={form.getValues('nickname') || form.getValues('username')}
              fallback={getFallbackAvatarFromUsername(form.getValues('nickname') || form.getValues('username'))}
              className="size-40 rounded-xl border-2"
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

          <div className="grid gap-2">
            <Label htmlFor="background">{t('background')}</Label>
            <Avatar className="h-40 w-80 rounded-sm border-2">
              <AvatarImage
                className="object-cover rounded-none"
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

          <FormField
            control={form.control}
            name="nickname"
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

          <FormField
            control={form.control}
            name="gender"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('gender')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="showIpLocation"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('show_ip_location')}</FormLabel>
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('language')}</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t('select_language')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {localesData
                      && Object.keys(localesData).map(locale => (
                        <SelectItem key={locale} value={locale}>
                          {localesData[locale].name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
            {t('update_profile')}
            {form.formState.isSubmitting && '...'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
