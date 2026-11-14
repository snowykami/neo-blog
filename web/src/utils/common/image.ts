import type { ImageProps } from 'next/image'

/**
 * 解析逗号分隔的图床域名白名单，自动规范化为小写去重后的 hostname 列表
 * 兼容误填协议或路径的情况（如 https://cdn.example.com/path）
 */
export function parseImageOptimizeHosts(raw: string | null | undefined): string[] {
  if (!raw)
    return []
  const hosts: string[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim().toLowerCase()
    if (!trimmed)
      continue
    let host = ''
    if (trimmed.includes('://')) {
      try {
        host = new URL(trimmed).hostname.toLowerCase()
      }
      catch {
        continue
      }
    }
    else {
      host = trimmed.replace(/^\/+|\/+$/g, '').split('/')[0] ?? ''
    }
    if (!host || /\s/.test(host))
      continue
    hosts.push(host)
  }
  return Array.from(new Set(hosts))
}

// 本站图床 / 对象存储域名白名单，逗号分隔；只有这些域名的 https 图片才交给 /_next/image 优化
// 必须使用全局 process：构建时只会内联全局 process.env.NEXT_PUBLIC_*，导入的 process 不会被替换
// eslint-disable-next-line node/prefer-global/process
export const IMAGE_OPTIMIZE_HOSTS = parseImageOptimizeHosts(process.env.NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS)

// 运行时由根布局注入的域名白名单快照（供无 React Context 的工具函数读取）
let runtimeImageOptimizeHosts: readonly string[] | null = null

/** 设置运行时图片优化域名白名单（传 null 重置为构建期配置） */
export function setRuntimeImageOptimizeHosts(hosts: readonly string[] | null): void {
  runtimeImageOptimizeHosts = hosts
}

/** 获取当前生效的图片优化域名白名单（优先运行时注入，其次构建期配置） */
export function getImageOptimizeHosts(): readonly string[] {
  return runtimeImageOptimizeHosts ?? IMAGE_OPTIMIZE_HOSTS
}

/**
 * 是否走 Next 图片优化：静态 import、站内相对路径、白名单域名的 https 图片走优化；
 * 其余站外地址由浏览器直连，避免服务端多绕一跳；解析失败按不优化处理
 */
export function shouldOptimize(src: ImageProps['src'] | null | undefined, hosts?: readonly string[]): boolean {
  if (!src)
    return false
  if (typeof src !== 'string')
    return true
  if (src.startsWith('/'))
    return !src.startsWith('//')
  try {
    const url = new URL(src)
    const allowlist = hosts ?? getImageOptimizeHosts()
    return url.protocol === 'https:' && allowlist.includes(url.hostname.toLowerCase())
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
