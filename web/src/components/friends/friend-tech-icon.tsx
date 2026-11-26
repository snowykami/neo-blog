import type { SVGProps } from 'react'
import type { FriendTechCategory } from '@/models/friend'
import { BookOpenIcon, CloudIcon, LayersIcon, ServerIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FriendTechIconProps {
  id: string
  category: FriendTechCategory | string
  className?: string
}

function BaseSvg({ className, children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('size-3.5 shrink-0', className)}
      {...props}
    >
      {children}
    </svg>
  )
}

export function FriendTechIcon({ id, category, className }: FriendTechIconProps) {
  const key = id.trim().toLowerCase()

  switch (key) {
    // ── CDN / 边缘 / WAF ──
    case 'cloudflare':
      return (
        <BaseSvg className={className}>
          <path d="M17.5 18H6.8a4.3 4.3 0 0 1-.5-8.57A5.8 5.8 0 0 1 17.6 8a3.8 3.8 0 0 1-.1 10Z" />
          <path d="M14.5 11.5 12.5 15h3l-1.5 3" />
        </BaseSvg>
      )
    case 'vercel':
      return (
        <BaseSvg className={className} fill="currentColor" stroke="none">
          <path d="M12 4 21 19.5H3L12 4Z" />
        </BaseSvg>
      )
    case 'edgeone':
      return (
        <BaseSvg className={className}>
          <polygon points="12 2.8 20 7.4 20 16.6 12 21.2 4 16.6 4 7.4" />
          <path d="M13 7.5 9.5 12.5h4L11 16.5" />
        </BaseSvg>
      )
    case 'netlify':
      return (
        <BaseSvg className={className}>
          <polygon points="12 2.8 21.2 12 12 21.2 2.8 12" />
          <path d="M8.5 15V9l7 6V9" />
        </BaseSvg>
      )
    case 'github-pages':
      return (
        <BaseSvg className={className}>
          <path d="M15 22v-3.5a3.3 3.3 0 0 0-.9-2.6c3-.3 6-1.5 6-6.5a5.1 5.1 0 0 0-1.4-3.5 4.7 4.7 0 0 0-.1-3.5s-1.1-.3-3.6 1.4a12.3 12.3 0 0 0-6 0C6.5 2.1 5.4 2.4 5.4 2.4a4.7 4.7 0 0 0-.1 3.5A5.1 5.1 0 0 0 3.9 9.4c0 5 3 6.2 6 6.5a3.3 3.3 0 0 0-.9 2.6V22" />
          <path d="M9 18c-4 1.4-4-2.2-6-2.6" />
        </BaseSvg>
      )
    case 'cloudfront':
      return (
        <BaseSvg className={className}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3.5 12h17" />
          <path d="M12 3a13.5 13.5 0 0 1 0 18" />
          <path d="M12 3a13.5 13.5 0 0 0 0 18" />
        </BaseSvg>
      )
    case 'fastly':
      return (
        <BaseSvg className={className}>
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2.8 1.8" />
          <path d="M9.5 2.5h5" />
        </BaseSvg>
      )
    case 'aliyun-cdn':
      return (
        <BaseSvg className={className}>
          <path d="M8.5 7H6a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h2.5" />
          <path d="M15.5 7H18a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-2.5" />
          <path d="M9 12h6" />
        </BaseSvg>
      )
    case 'tencent-cdn':
      return (
        <BaseSvg className={className}>
          <path d="M17.5 18.5H7a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 17.2 9a3.5 3.5 0 0 1 .3 9.5Z" />
          <path d="M9.5 13.5h5" />
          <path d="M12 11v5" />
        </BaseSvg>
      )
    case 'deno-deploy':
      return (
        <BaseSvg className={className}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
          <path d="M14 14c1.5 0 3 1.2 3 3v3" />
          <path d="M8.5 14.5c1.2.8 2.8.8 4 0" />
        </BaseSvg>
      )
    case 'zeabur':
      return (
        <BaseSvg className={className}>
          <path d="M5 7h14L7 17h12" />
        </BaseSvg>
      )

    // ── Web 服务器 ──
    case 'nginx':
    case 'openresty':
    case 'tengine':
      return (
        <BaseSvg className={className}>
          <polygon points="12 2.6 20.2 7.3 20.2 16.7 12 21.4 3.8 16.7 3.8 7.3" />
          <path d="M8.8 15.5v-7l6.4 7v-7" />
        </BaseSvg>
      )
    case 'caddy':
      return (
        <BaseSvg className={className}>
          <rect x="5" y="11" width="14" height="9" rx="2.2" />
          <path d="M8 11V7.8a4 4 0 0 1 8 0V11" />
          <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
        </BaseSvg>
      )
    case 'traefik':
      return (
        <BaseSvg className={className}>
          <circle cx="6.5" cy="12" r="2.2" />
          <circle cx="17.5" cy="7" r="2.2" />
          <circle cx="17.5" cy="17" r="2.2" />
          <path d="M8.7 11.2 15.3 7.8" />
          <path d="M8.7 12.8 15.3 16.2" />
        </BaseSvg>
      )
    case 'apache':
      return (
        <BaseSvg className={className}>
          <path d="M18.5 4.5c-4.5 1.5-8.5 5.5-11 11L5 20l4.5-2.5c5.5-2.5 9.5-6.5 11-11l-2-2Z" />
          <path d="M9.5 14.5 15 9" />
        </BaseSvg>
      )
    case 'litespeed':
      return (
        <BaseSvg className={className}>
          <path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12L13 3Z" />
        </BaseSvg>
      )
    case 'envoy':
      return (
        <BaseSvg className={className}>
          <polygon points="12 3 21 8.2 21 15.8 12 21 3 15.8 3 8.2" />
          <circle cx="12" cy="12" r="3" />
        </BaseSvg>
      )

    // ── 博客 / CMS 软件 ──
    case 'neo-blog':
      return (
        <BaseSvg className={className}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
          <path d="M8.5 16V8l7 8V8" />
        </BaseSvg>
      )
    case 'hexo':
      return (
        <BaseSvg className={className}>
          <polygon points="12 2.6 20.2 7.3 20.2 16.7 12 21.4 3.8 16.7 3.8 7.3" />
          <path d="M9 8.5v7" />
          <path d="M15 8.5v7" />
          <path d="M9 12h6" />
        </BaseSvg>
      )
    case 'hugo':
      return (
        <BaseSvg className={className}>
          <polygon points="8.2 3 15.8 3 21 8.2 21 15.8 15.8 21 8.2 21 3 15.8 3 8.2" />
          <path d="M9 8.5v7" />
          <path d="M15 8.5v7" />
          <path d="M9 12h6" />
        </BaseSvg>
      )
    case 'astro':
      return (
        <BaseSvg className={className}>
          <path d="M12 3.5 5.5 18.5h3.6l1.3-3.2h3.2l1.3 3.2h3.6L12 3.5Z" />
          <path d="M9.8 19.2c.7 1.3 3.7 1.3 4.4 0" />
        </BaseSvg>
      )
    case 'wordpress':
      return (
        <BaseSvg className={className}>
          <circle cx="12" cy="12" r="9" />
          <path d="m6.8 8.5 2.7 7.5 2.5-6 2.5 6 2.7-7.5" />
        </BaseSvg>
      )
    case 'halo':
      return (
        <BaseSvg className={className}>
          <ellipse cx="12" cy="7.5" rx="7" ry="2.6" />
          <path d="M6.5 11.5a6.5 6.5 0 0 0 11 0" />
          <path d="M8.5 16.5a5 5 0 0 0 7 0" />
        </BaseSvg>
      )
    case 'typecho':
      return (
        <BaseSvg className={className}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
          <path d="M8 8.5h8" />
          <path d="M12 8.5v7.5" />
        </BaseSvg>
      )
    case 'mix-space':
      return (
        <BaseSvg className={className}>
          <circle cx="12" cy="12" r="8.8" />
          <path d="M7.5 15.5v-6l4.5 4 4.5-4v6" />
        </BaseSvg>
      )
    case 'vitepress':
    case 'vuepress':
      return (
        <BaseSvg className={className}>
          <path d="M4.5 5.5h6a2.5 2.5 0 0 1 2.5 2.5v11a2 2 0 0 0-2-2h-6.5v-11.5Z" />
          <path d="M19.5 5.5h-6A2.5 2.5 0 0 0 11 8v11a2 2 0 0 1 2-2h6.5V5.5Z" />
        </BaseSvg>
      )
    case 'ghost':
      return (
        <BaseSvg className={className}>
          <path d="M12 3a7 7 0 0 0-7 7v9l2.3-1.7L9.7 19 12 17.3 14.3 19l2.4-1.7L19 19v-9a7 7 0 0 0-7-7Z" />
          <circle cx="9.8" cy="10.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="14.2" cy="10.5" r="1" fill="currentColor" stroke="none" />
        </BaseSvg>
      )
    case 'jekyll':
      return (
        <BaseSvg className={className}>
          <path d="M10 3h4" />
          <path d="M11 3v4.5L6.5 16.5A3 3 0 0 0 9.2 21h5.6a3 3 0 0 0 2.7-4.5L13 7.5V3" />
          <path d="M8 15h8" />
        </BaseSvg>
      )
    case 'gridea':
      return (
        <BaseSvg className={className}>
          <circle cx="12" cy="12" r="8.8" />
          <path d="M15 9.5a3.8 3.8 0 1 0 0 5.2V12h-2.8" />
        </BaseSvg>
      )
    case 'docusaurus':
      return (
        <BaseSvg className={className}>
          <path d="M6 19v-6a6 6 0 0 1 6-6h4a2 2 0 0 1 2 2v3a3 3 0 0 1-3 3h-3v4" />
          <circle cx="14.5" cy="9.5" r="0.9" fill="currentColor" stroke="none" />
          <path d="M9 7 7.5 5" />
          <path d="M12 6.2 11.5 4" />
        </BaseSvg>
      )
    case 'notion-next':
      return (
        <BaseSvg className={className}>
          <rect x="4" y="4" width="16" height="16" rx="2.5" />
          <path d="M8.8 15.5v-7l6.4 7v-7" />
        </BaseSvg>
      )

    // ── 前端框架 ──
    case 'nextjs':
      return (
        <BaseSvg className={className}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 15.5V8.5l8.2 10.2" />
          <path d="M15 8.5v4.5" />
        </BaseSvg>
      )
    case 'nuxt':
      return (
        <BaseSvg className={className}>
          <path d="M3.2 18.5 9.8 7l6.6 11.5H3.2Z" />
          <path d="m11.5 18.5 4.2-7.3 5.1 7.3h-9.3Z" />
        </BaseSvg>
      )
    case 'sveltekit':
      return (
        <BaseSvg className={className}>
          <path d="M15.8 5.2a4.2 4.2 0 0 0-5.8-.9L7.6 6a4.2 4.2 0 0 0-.8 6.1 4.2 4.2 0 0 0 .8 5.7 4.2 4.2 0 0 0 5.8.9l2.4-1.7a4.2 4.2 0 0 0 .8-6.1 4.2 4.2 0 0 0-.8-5.7Z" />
          <path d="M9.5 10.5c1.5-1 3.5-1 5 0" />
          <path d="M9.5 13.8c1.5 1 3.5 1 5 0" />
        </BaseSvg>
      )
    case 'react':
      return (
        <BaseSvg className={className}>
          <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
          <ellipse cx="12" cy="12" rx="9" ry="3.6" />
          <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" />
        </BaseSvg>
      )
    case 'vue':
      return (
        <BaseSvg className={className}>
          <path d="M3.2 5.5 12 20l8.8-14.5h-3.6L12 14.2 6.8 5.5H3.2Z" />
          <path d="M7.4 5.5 12 13l4.6-7.5" />
        </BaseSvg>
      )
    case 'jquery':
      return (
        <BaseSvg className={className}>
          <path d="M6.5 9.5a6.5 6.5 0 0 0 9.2 9.2" />
          <path d="M10.2 6.8a5 5 0 0 0 7 7" />
          <path d="M13.8 4.2a3.4 3.4 0 0 0 4.8 4.8" />
        </BaseSvg>
      )

    default:
      switch (category) {
        case 'cdn':
          return <CloudIcon aria-hidden="true" className={cn('size-3.5 shrink-0', className)} />
        case 'server':
          return <ServerIcon aria-hidden="true" className={cn('size-3.5 shrink-0', className)} />
        case 'cms':
          return <BookOpenIcon aria-hidden="true" className={cn('size-3.5 shrink-0', className)} />
        default:
          return <LayersIcon aria-hidden="true" className={cn('size-3.5 shrink-0', className)} />
      }
  }
}
