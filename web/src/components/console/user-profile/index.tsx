"use client"
import { uploadFile } from "@/api/file";
import { updateUser } from "@/api/user";
import { ImageCropper } from "@/components/common/image-cropper";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/auth-context";
import { getFileUri } from "@/utils/client/file";
import { getGravatarFromUser } from "@/utils/common/gravatar";
import { getFallbackAvatarFromUsername } from "@/utils/common/username";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";


interface UploadConstraints {
  allowedTypes: string[];
  maxSize: number;
}

interface PictureInputChangeEvent {
  target: HTMLInputElement & { files?: FileList | null };
}

export function UserProfilePage() {
  const t = useTranslations("Console.user_profile")
  const { user } = useAuth();
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [username, setUsername] = useState(user?.username || '')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarFileUrl, setAvatarFileUrl] = useState<string | null>(null) // 这部分交由useEffect控制，监听 avatarFile 变化
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  const [backgroundFileUrl, setBackgroundFileUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [gender, setGender] = useState(user?.gender || '')


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

  const handlePictureSelected = (e: PictureInputChangeEvent): void => {
    const file: File | null = e.target.files?.[0] ?? null;
    if (!file) {
      setAvatarFile(null);
      return;
    }
    const constraints: UploadConstraints = {
      allowedTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      maxSize: 5 * 1024 * 1024, // 5 MB
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
      maxSize: 5 * 1024 * 1024, // 5 MB
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

  const handleSubmit = () => {
    if (!user) return;
    if (
      nickname.trim() === '' ||
      username.trim() === ''
    ) {
      toast.error(t("nickname_and_username_cannot_be_empty"))
      return
    }

    if (
      (username.length < 1 || username.length > 20) ||
      (nickname.length < 1 || nickname.length > 20)
    ) {
      toast.error(t("nickname_and_username_must_be_between", { "min": 1, "max": 20 }))
      return
    }

    if (
      username === user.username &&
      nickname === user.nickname &&
      gender === user.gender &&
      avatarFile === null &&
      backgroundFile === null
    ) {
      toast.warning(t("no_changes_made"))
      return
    }

    let avatarUrl = user.avatarUrl;
    let backgroundUrl = user.backgroundUrl;
    setSubmitting(true);
    (async () => {
      if (avatarFile) {
        try {
          const resp = await uploadFile({ file: avatarFile });
          avatarUrl = getFileUri(resp.data.id);
        } catch (error: unknown) {
          toast.error(`${t("failed_to_upload_avatar")}: ${error}`);
          return;
        }
      }

      if (backgroundFile) {
        try {
          const resp = await uploadFile({ file: backgroundFile });
          backgroundUrl = getFileUri(resp.data.id);
        } catch (error: unknown) {
          toast.error(`${t("failed_to_upload_background")}: ${error}`);
          return;
        }
      }

      try {
        await updateUser({ nickname, username, avatarUrl, backgroundUrl, gender, id: user.id });
        window.location.reload();
      } catch (error: unknown) {
        toast.error(`${t("failed_to_update_profile")}: ${error}`);
      } finally {
        setSubmitting(false);
      }
    })();

  }

  const handleCropped = (blob: Blob) => {
    const file = new File([blob], 'avatar.png', { type: blob.type });
    setAvatarFile(file);
  }

  if (!user) return null

  return (
    <div>
      <h1 className="text-2xl font-bold">
        {t("public_profile")}
      </h1>
      <Separator className="my-2" />
      <div className="grid w-full max-w-sm items-center gap-4">
        <div className="grid gap-2">
          <Label htmlFor="picture">{t("picture")}</Label>
          <Avatar className="h-40 w-40 rounded-xl border-2">
            {avatarFileUrl ?
              <AvatarImage src={avatarFileUrl} alt={nickname || username} /> :
              <AvatarImage src={getGravatarFromUser({ user })} alt={nickname || username} />}
            <AvatarFallback>{getFallbackAvatarFromUsername(nickname || username)}</AvatarFallback>
          </Avatar>
          <div className="flex gap-2"><Input
            id="picture"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/*"
            onChange={handlePictureSelected}
          />
            <ImageCropper image={avatarFile} onCropped={handleCropped} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nickname">{t("nickname")}</Label>
          <Input type="nickname" id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="username">{t("username")}</Label>
          <Input type="username" id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div >
        <div className="grid gap-2">
          <Label htmlFor="gender">{t("gender")}</Label>
          <Input type="gender" id="gender" value={gender} onChange={(e) => setGender(e.target.value)} />
        </div>




        <Button className="max-w-1/3" onClick={handleSubmit} disabled={submitting}>{t("update_profile")}{submitting && '...'}</Button>
      </div>
    </div>
  )
}

export function PictureEditor({ }) {

}