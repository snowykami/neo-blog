import type { User } from '@/models/user'
import md5 from 'md5'

//  32  小图标、评论列表
//  64  移动端评论头像
//  80  默认显示尺寸（Gravatar 默认）
//  96  WordPress 默认头像尺寸
//  128 侧边栏作者头像
//  256 用户资料页
//  512 最大支持尺寸（上传原图也限于此）

export function getGravatarUrl({
  email,
  size,
  proxy = 'cn.gravatar.com',
}: {
  email?: string
  size?: number
  proxy?: string
}): string {
  const hash = md5((email || '').trim().toLowerCase())
  return `https://${proxy || 'www.gravatar.com'}/avatar/${hash}?s=${size}&d=identicon`
}

// 按 Gravatar 哈希生成头像地址（后端返回邮箱的 SHA-256，公开接口不暴露邮箱本身）
export function getGravatarUrlByHash({
  hash,
  size,
  proxy = 'cn.gravatar.com',
}: {
  hash: string
  size?: number
  proxy?: string
}): string {
  return `https://${proxy || 'www.gravatar.com'}/avatar/${hash}?s=${size}&d=identicon`
}

/**
 * 解析用户头像，全平台统一的优先级：
 * 平台设置的头像（首次第三方登录时会写入第三方头像）> Gravatar（按邮箱哈希）> 按用户名生成的默认头像
 * 不论是本人信息还是公开信息，同一用户得到的地址一致
 */
export function getAvatarOrGravatarUrlFromUser({
  user,
  size = 120,
}: {
  user: Pick<User, 'avatarUrl' | 'gravatarHash' | 'username'>
  size?: number
}): string {
  if (user.avatarUrl)
    return user.avatarUrl
  if (user.gravatarHash)
    return getGravatarUrlByHash({ hash: user.gravatarHash, size })
  return getGravatarUrl({ email: user.username, size })
}
