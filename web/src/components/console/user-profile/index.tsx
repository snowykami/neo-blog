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
  if (!user) return null

  const [nickname, setNickname] = useState(user.nickname || '')
  const [username, setUsername] = useState(user.username || '')
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [gender, setGender] = useState(user.gender || '')

  useEffect(() => {
    // if (!avatarFile) return
    // uploadFile({ file: avatarFile! }).then(res => {
    //   setAvatarUrl(getFileUri(res.data.id))
    //   toast.success('Avatar uploaded successfully')
    // }).catch(err => {
    //   console.log(err)
    //   toast.error(`Error: ${err?.response?.data?.message || err.message || 'Failed to upload avatar'}`)
    // })
  }, [avatarFile])

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
    if (nickname.trim() === '' || username.trim() === '') {
      toast.error('Nickname and Username cannot be empty')
      return
    }
    if ((username.length < 3 || username.length > 20) || (nickname.length < 1 || nickname.length > 20)) {
      toast.error('Nickname and Username must be between 3 and 20 characters')
      return
    }
    if (username === user.username && nickname === user.nickname && avatarUrl === user.avatarUrl && gender === user.gender) {
      toast.warning('No changes made')
      return
    }
    updateUser({ nickname, username, avatarUrl, gender, id: user.id }).then(res => {
      toast.success('Profile updated successfully')
      window.location.reload()
    }).catch(err => {
      console.log(err)
      toast.error(`Error: ${err?.response.data?.message || err.message || 'Failed to update profile'}`)
    })
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">
        Public Profile
      </h1>
      <Separator className="my-2" />
      <div className="grid w-full max-w-sm items-center gap-3">
        <Label htmlFor="picture">Picture</Label>
        <Avatar className="h-40 w-40 rounded-xl border-2">
          {!avatarFile && <AvatarImage src={getGravatarFromUser({ user })} alt={user.username} />}
          {avatarFile && <AvatarImage src={URL.createObjectURL(avatarFile)} alt={user.username} />}
          <AvatarFallback>{getFallbackAvatarFromUsername(nickname || username)}</AvatarFallback>
        </Avatar>

        <div className="flex gap-3"><Input
          id="picture"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/*"
          onChange={handlePictureSelected}
        />
          <ImageCropper />
        </div>
        <Input
          id="picture-url"
          type="url"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="若要用外链图像，请直接填写，不支持裁剪"
        />
        <Label htmlFor="nickname">Nickname</Label>
        <Input type="nickname" id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        <Label htmlFor="username">Username</Label>
        <Input type="username" id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Label htmlFor="gender">Gender</Label>
        <Input type="gender" id="gender" value={gender} onChange={(e) => setGender(e.target.value)} />
        <Button className="max-w-1/3" onClick={handleSubmit}>Submit</Button>
      </div>
    </div>
  )
}

export function PictureEditor({}){

}