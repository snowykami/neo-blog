import type { ImageProps } from 'next/image'

/** Next 图片优化允许的压缩质量档位（需与 next.config.ts images.qualities 同步）：45 小头像/微缩图，60 列表卡片/中图，75 详情大图与品牌图标 */
export const IMAGE_QUALITIES = [45, 60, 75] as const
export type ImageQuality = (typeof IMAGE_QUALITIES)[number]

/** 根据 ImageAvatar 的 sizes 推导默认压缩档位：<=64px 小头像用 45，<=120px 中头像用 60，其余大头像用 75 */
export function defaultAvatarQuality(sizes: string): ImageQuality {
  const match = /^(\d+)px$/.exec(sizes.trim())
  if (!match)
    return 75
  const px = Number(match[1])
  if (px <= 64)
    return 45
  if (px <= 120)
    return 60
  return 75
}

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

const UNOPTIMIZABLE_IMAGE_RE = /\.(?:svg|ico)(?:$|[?#])/i

/**
 * 是否走 Next 图片优化：静态 import、站内相对路径、白名单域名的 https 位图走优化；
 * svg / ico 及站外非白名单地址由浏览器直连，避免无意义的服务端绕跳；解析失败按不优化处理
 */
export function shouldOptimize(src: ImageProps['src'] | null | undefined, hosts?: readonly string[]): boolean {
  if (!src)
    return false
  if (typeof src !== 'string')
    return true
  if (UNOPTIMIZABLE_IMAGE_RE.test(src))
    return false
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
  // 网易云音乐 CDN：自动升级为 https，并添加 imageView 边缘裁剪 + WebP 转码参数
  if (url.includes('music.126.net')) {
    const [base] = url.replace(/^http:/, 'https:').split('?')
    return `${base}?imageView=1&thumbnail=${size}y${size}&type=webp`
  }
  return url
}
