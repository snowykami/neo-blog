
import md5 from "md5";
import type { User } from '@/models/user';

// 32	小图标、评论列表
// 64	移动端评论头像
// 80	默认显示尺寸（Gravatar 默认）
// 96	WordPress 默认头像尺寸
// 128	侧边栏作者头像
// 256	用户资料页
// 512	最大支持尺寸（上传原图也限于此）

export function getGravatarUrl({ email, size, proxy }: { email: string, size?: number, proxy?: string }): string {
  const hash = md5(email.trim().toLowerCase());
  return `https://${proxy ? proxy : "www.gravatar.com"}/avatar/${hash}?s=${size}&d=identicon`;
}

export function getGravatarFromUser({ user, size = 120 }: { user: User, size?: number }): string {
  return user.avatarUrl || getGravatarUrl({ email: user.email, size: size });
}