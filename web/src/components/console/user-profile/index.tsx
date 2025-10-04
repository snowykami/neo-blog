"use client"
import { uploadFile } from "@/api/file";
import { updateUser } from "@/api/user";
import { ImageCropper } from "@/components/common/image-cropper";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { getFileUri } from "@/utils/client/file";
import { getGravatarFromUser } from "@/utils/common/gravatar";
import { getFallbackAvatarFromUsername } from "@/utils/common/username";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useForm } from "react-hook-form";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localesData } from "@/locales";

interface UploadConstraints {
  allowedTypes: string[];
  maxSize: number;
}

interface PictureInputChangeEvent {
  target: HTMLInputElement & { files?: FileList | null };
}

type FormValues = {
  nickname: string;
  username: string;
  gender: string;
  language: string;
};

export function UserProfilePage() {
  const t = useTranslations("Console.user_profile")
  const { user } = useAuth();

  const form = useForm<FormValues>({
    defaultValues: {
      nickname: user?.nickname ?? "",
      username: user?.username ?? "",
      gender: user?.gender ?? "",
      language: user?.language ?? "en",
    },
  });

  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarFileUrl, setAvatarFileUrl] = useState<string | null>(null)
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  const [backgroundFileUrl, setBackgroundFileUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return;
    if (!avatarFile) {
      setAvatarFileUrl(getGravatarFromUser({ user }));
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarFileUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setAvatarFileUrl(getGravatarFromUser({ user }));
    };
  }, [avatarFile, user]);

  useEffect(() => {
    if (!user) return;
    if (!backgroundFile) {
      setBackgroundFileUrl(null);
      return;
    }
    const url = URL.createObjectURL(backgroundFile);
    setBackgroundFileUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setBackgroundFileUrl(null);
    };
  }, [backgroundFile, user]);

  const isProfileChanged = (): boolean => {
    if (!user) return false;
    const values = form.getValues();
    return (
      values.nickname.trim() !== (user.nickname ?? "") ||
      values.username.trim() !== (user.username ?? "") ||
      values.gender !== (user.gender ?? "") ||
      values.language !== (user.language ?? "") ||
      avatarFile !== null ||
      backgroundFile !== null
    );
  }

  const handlePictureSelected = (e: PictureInputChangeEvent): void => {
    const file: File | null = e.target.files?.[0] ?? null;
    if (!file) {
      setAvatarFile(null);
      return;
    }
    const constraints: UploadConstraints = {
      allowedTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      maxSize: 5 * 1024 * 1024,
    };
    if (!file.type || !file.type.startsWith('image/') || !constraints.allowedTypes.includes(file.type)) {
      setAvatarFile(null);
      toast.error(t("only_allow_picture"));
      return;
    }
    if (file.size > constraints.maxSize) {
      setAvatarFile(null);
      toast.error(t("picture_size_cannot_exceed", { "size": "5MiB" }));
      return;
    }
    setAvatarFile(file);
  }

  const handleBackgroundSelected = (e: PictureInputChangeEvent): void => {
    const file: File | null = e.target.files?.[0] ?? null;
    if (!file) {
      setBackgroundFile(null);
      return;
    }
    const constraints: UploadConstraints = {
      allowedTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      maxSize: 5 * 1024 * 1024,
    };
    if (!file.type || !file.type.startsWith('image/') || !constraints.allowedTypes.includes(file.type)) {
      setBackgroundFile(null);
      toast.error(t("only_allow_picture"));
      return;
    }
    if (file.size > constraints.maxSize) {
      setBackgroundFile(null);
      toast.error(t("picture_size_cannot_exceed", { "size": "5MiB" }));
      return;
    }
    setBackgroundFile(file);
  }

  const handleCropped = (blob: Blob) => {
    const file = new File([blob], 'avatar.png', { type: blob.type });
    setAvatarFile(file);
  }

  if (!user) return null

  const onSubmit = form.handleSubmit(async (values) => {
    // check values nickname可为空
    if (values.username.trim() === '') {
      toast.error(t("nickname_and_username_cannot_be_empty"))
      return;
    }
    if (
      (values.username.length < 1 || values.username.length > 20) ||
      (values.nickname.length > 20)
    ) {
      toast.error(t("nickname_and_username_must_be_between", { "min": 1, "max": 20 }))
      return;
    }

    if (!isProfileChanged()) {
      toast.warning(t("no_changes_made"))
      return;
    }

    let avatarUrl = user.avatarUrl;
    let backgroundUrl = user.backgroundUrl;

    try {
      if (avatarFile) {
        const resp = await uploadFile({ file: avatarFile, name: avatarFile.name });
        avatarUrl = getFileUri(resp.data.id);
      }
      if (backgroundFile) {
        const resp = await uploadFile({ file: backgroundFile, name: backgroundFile.name });
        backgroundUrl = getFileUri(resp.data.id);
      }

      await updateUser({
        id: user.id,
        nickname: values.nickname,
        username: values.username,
        gender: values.gender,
        language: values.language,
        avatarUrl,
        backgroundUrl,
      });
      window.location.reload();
    } catch (error: unknown) {
      toast.error(`${t("failed_to_update_profile")}: ${String(error)}`);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid w-full max-w-sm items-center gap-4">
        <h1 className="text-2xl font-bold">{t("public_profile")}</h1>

        <div className="grid w-full items-center gap-4">
          <div className="grid gap-2">
            <Label htmlFor="picture">{t("picture")}</Label>
            <Avatar className="h-40 w-40 rounded-xl border-2">
              {avatarFileUrl ?
                <AvatarImage src={avatarFileUrl} alt={form.getValues("nickname") || form.getValues("username")} /> :
                <AvatarImage src={getGravatarFromUser({ user })} alt={form.getValues("nickname") || form.getValues("username")} />}
              <AvatarFallback>{getFallbackAvatarFromUsername(form.getValues("nickname") || form.getValues("username"))}</AvatarFallback>
            </Avatar>
            <div className="flex gap-2">
              <Input
                id="picture"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/*"
                onChange={handlePictureSelected}
              />
              <ImageCropper image={avatarFile} onCropped={handleCropped} initialAspect={1} lockAspect={true} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="background">{t("background")}</Label>
            <Avatar className="h-40 w-80 rounded-sm border-2">
              {backgroundFileUrl ?
                <AvatarImage className="object-cover rounded-none" src={backgroundFileUrl} alt={form.getValues("nickname") || form.getValues("username")} /> :
                <AvatarImage className="object-cover rounded-none" src={user.backgroundUrl} alt={form.getValues("nickname") || form.getValues("username")} />
              }
              <AvatarFallback className="rounded-none">{t("background")}</AvatarFallback>
            </Avatar>
            <div className="flex gap-2">
              <Input
                id="background"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/*"
                onChange={handleBackgroundSelected}
              />
              <ImageCropper image={backgroundFile} onCropped={(blob) => {
                const file = new File([blob], 'background.png', { type: blob.type });
                setBackgroundFile(file);
              }} initialAspect={3} lockAspect={false} />
            </div>
          </div>

          <FormField
            control={form.control}
            name="nickname"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("nickname")}</FormLabel>
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
                <FormLabel>{t("username")}</FormLabel>
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
                <FormLabel>{t("gender")}</FormLabel>
                <FormControl>
                  <Input {...field} />
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
                <FormLabel>{t("language")}</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a language" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {localesData && Object.keys(localesData).map((locale) => (
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
            {t("update_profile")}
            {form.formState.isSubmitting && '...'}
          </Button>
        </div>
      </form>
    </Form>
  )
}