import type { ImageProps } from 'next/image'

// 本站图床 / 对象存储域名白名单，逗号分隔；只有这些域名的 https 图片才交给 /_next/image 优化
// 必须使用全局 process：构建时只会内联全局 process.env.NEXT_PUBLIC_*，导入的 process 不会被替换
// eslint-disable-next-line node/prefer-global/process
export const IMAGE_OPTIMIZE_HOSTS = (process.env.NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS ?? '')
  .split(',')
  .map(host => host.trim().toLowerCase())
  .filter(Boolean)

/**
 * 是否走 Next 图片优化：静态 import、站内相对路径、白名单域名的 https 图片走优化；
 * 其余站外地址由浏览器直连，避免服务端多绕一跳；解析失败按不优化处理
 */
export function shouldOptimize(src: ImageProps['src'] | null | undefined): boolean {
  if (!src)
    return false
  if (typeof src !== 'string')
    return true
  if (src.startsWith('/'))
    return !src.startsWith('//')
  try {
    const url = new URL(src)
    return url.protocol === 'https:' && IMAGE_OPTIMIZE_HOSTS.includes(url.hostname)
  }
  catch {
    return false
  }
}
