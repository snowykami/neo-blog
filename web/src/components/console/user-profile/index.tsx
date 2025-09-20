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
  const { user } = useAuth();
  

  const [nickname, setNickname] = useState(user?.nickname || '')
  const [username, setUsername] = useState(user?.username || '')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarFileUrl, setAvatarFileUrl] = useState<string | null>(null) // 这部分交由useEffect控制，监听 avatarFile 变化
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
      toast.error('只允许上传 PNG / JPEG / WEBP / GIF 格式的图片');
      return;
    }
    if (file.size > constraints.maxSize) {
      setAvatarFile(null);
      toast.error('图片大小不能超过 5MB');
      return;
    }
    setAvatarFile(file);
  }

  const handleSubmit = () => {
    if (!user) return;
    if (
      nickname.trim() === '' ||
      username.trim() === ''
    ) {
      toast.error('Nickname and Username cannot be empty')
      return
    }

    if (
      (username.length < 3 || username.length > 20) ||
      (nickname.length < 1 || nickname.length > 20)
    ) {
      toast.error('Nickname and Username must be between 3 and 20 characters')
      return
    }

    if (
      username === user.username &&
      nickname === user.nickname &&
      gender === user.gender &&
      avatarFile === null
    ) {
      toast.warning('No changes made')
      return
    }

    let avatarUrl = user.avatarUrl;
    setSubmitting(true);
    (async () => {
      if (avatarFile) {
        try {
          const resp = await uploadFile({ file: avatarFile });
          avatarUrl = getFileUri(resp.data.id);
          console.log('Uploaded avatar, got URL:', avatarUrl);
        } catch (error: unknown) {
          toast.error(`Failed to upload avatar ${error}`);
          return;
        }
      }

      try {
        await updateUser({ nickname, username, avatarUrl, gender, id: user.id });
        toast.success('Profile updated successfully');
        window.location.reload();
      } catch (error: unknown) {
        toast.error(`Failed to update profile ${error}`);
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
        Public Profile
      </h1>
      <Separator className="my-2" />
      <div className="grid w-full max-w-sm items-center gap-3">
        <Label htmlFor="picture">Picture</Label>
        <Avatar className="h-40 w-40 rounded-xl border-2">
          {avatarFileUrl ?
            <AvatarImage src={avatarFileUrl} alt={nickname || username} /> :
            <AvatarImage src={getGravatarFromUser({ user })} alt={nickname || username} />}
          <AvatarFallback>{getFallbackAvatarFromUsername(nickname || username)}</AvatarFallback>
        </Avatar>
        <div className="flex gap-3"><Input
          id="picture"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/*"
          onChange={handlePictureSelected}
        />
          <ImageCropper image={avatarFile} onCropped={handleCropped} />
        </div>
        <Label htmlFor="nickname">Nickname</Label>
        <Input type="nickname" id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        <Label htmlFor="username">Username</Label>
        <Input type="username" id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Label htmlFor="gender">Gender</Label>
        <Input type="gender" id="gender" value={gender} onChange={(e) => setGender(e.target.value)}/>
        <Button className="max-w-1/3" onClick={handleSubmit} disabled={submitting}>Submit{submitting && '...'}</Button>
      </div>
    </div>
  )
}

export function PictureEditor({ }) {

}