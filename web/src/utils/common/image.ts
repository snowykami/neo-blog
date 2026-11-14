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

/**
 * 针对第三方音乐封面（如网易云音乐等），利用其官方 CDN 边缘裁剪参数进行尺寸压缩与瘦身；
 * 避免浏览器直连拉取数兆超大原图，同时不增加自有服务器代理负担。
 */
export function formatMusicCoverUrl(url: string | null | undefined, size = 300): string {
  if (!url)
    return ''
  // 网易云音乐 CDN：自动升级为 https，并添加 ?param={size}y{size} 动态尺寸裁剪参数
  if (url.includes('music.126.net')) {
    const [base] = url.replace(/^http:/, 'https:').split('?')
    return `${base}?param=${size}y${size}`
  }
  return url
}
