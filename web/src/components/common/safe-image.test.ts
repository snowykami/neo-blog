import type { SiteInfo } from '@/utils/common/siteinfo'
import { NextIntlClientProvider } from 'next-intl'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageOptimizeProvider } from '@/contexts/image-optimize-context'
import { SiteInfoProvider } from '@/contexts/site-info-context'
import { SafeImage } from './safe-image'
import { SiteLogo } from './site-logo'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('safe-image 远程优化降级兜底', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div')
    host.style.position = 'relative'
    host.style.width = '320px'
    host.style.height = '180px'
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    document.body.innerHTML = ''
  })

  it('白名单远程图片首次经 /_next/image 失败时先静默降级为直连原图，再次失败才切换 fallbackSrc 并触发外部 onError', async () => {
    const onError = vi.fn()
    await act(async () => {
      root.render(
        React.createElement(NextIntlClientProvider, {
          locale: 'zh',
          messages: { Common: { image_load_failed: '加载失败' } },
          children: React.createElement(ImageOptimizeProvider, {
            hosts: ['sfkm-blog.r2.liteyuki.org'],
            children: React.createElement(SafeImage, {
              src: 'https://sfkm-blog.r2.liteyuki.org/snowykami-blog/a.png',
              fallbackSrc: '/fallback.png',
              alt: '封面',
              fill: true,
              sizes: '320px',
              onError,
            }),
          }),
        }),
      )
    })

    const firstImg = host.querySelector('img')
    expect(firstImg).toBeTruthy()
    expect(firstImg?.getAttribute('src')).toContain('/_next/image?url=https%3A%2F%2Fsfkm-blog.r2.liteyuki.org%2Fsnowykami-blog%2Fa.png')

    // 第一次加载失败（如上游返回 application/octet-stream）：先降级直连原图，且不向外部透传 onError
    await act(async () => {
      firstImg?.dispatchEvent(new Event('error'))
    })

    expect(onError).not.toHaveBeenCalled()
    const directImg = host.querySelector('img')
    expect(directImg).toBeTruthy()
    expect(directImg?.getAttribute('src')).toBe('https://sfkm-blog.r2.liteyuki.org/snowykami-blog/a.png')
    expect(directImg?.getAttribute('srcset')).toBeNull()

    // 第二次（直连也失败）：触发外部 onError，并切换到 fallbackSrc（站内路径，继续走 /_next/image）
    await act(async () => {
      directImg?.dispatchEvent(new Event('error'))
    })

    expect(onError).toHaveBeenCalledTimes(1)
    const fallbackImg = host.querySelector('img')
    expect(fallbackImg).toBeTruthy()
    expect(fallbackImg?.getAttribute('src')).toContain('/_next/image?url=%2Ffallback.png')

    // 若连 fallbackSrc 也失败：渲染占位块
    await act(async () => {
      fallbackImg?.dispatchEvent(new Event('error'))
    })
    expect(onError).toHaveBeenCalledTimes(2)
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('[role="img"]')).toBeTruthy()
  })

  it('站内 /api/v1/file/f/ 图片经 /_next/image 优化时附带 proxy=1，失败后静默降级为原始直连路径', async () => {
    const onError = vi.fn()
    await act(async () => {
      root.render(
        React.createElement(NextIntlClientProvider, {
          locale: 'zh',
          messages: { Common: { image_load_failed: '加载失败' } },
          children: React.createElement(ImageOptimizeProvider, {
            hosts: [],
            children: React.createElement(SafeImage, {
              src: '/api/v1/file/f/105',
              alt: '站内图',
              fill: true,
              sizes: '320px',
              onError,
            }),
          }),
        }),
      )
    })

    const firstImg = host.querySelector('img')
    expect(firstImg?.getAttribute('src')).toContain('/_next/image?url=%2Fapi%2Fv1%2Ffile%2Ff%2F105%3Fproxy%3D1')

    await act(async () => {
      firstImg?.dispatchEvent(new Event('error'))
    })

    expect(onError).not.toHaveBeenCalled()
    const directImg = host.querySelector('img')
    expect(directImg?.getAttribute('src')).toMatch(/^(?:http:\/\/localhost:3000)?\/api\/v1\/file\/f\/105$/)
    expect(directImg?.getAttribute('srcset')).toBeNull()
  })
})

describe('site-logo 图片优化控制', () => {
  it('白名单 OSS 位图图标走 /_next/image 优化，.ico 与 .svg 保持直连', () => {
    const renderLogo = (icon: string) => renderToStaticMarkup(
      React.createElement(ImageOptimizeProvider, {
        hosts: ['sfkm-blog.r2.liteyuki.org'],
        children: React.createElement(SiteInfoProvider, {
          initialData: { metadata: { icon } } as unknown as SiteInfo,
          children: React.createElement(SiteLogo),
        }),
      }),
    )

    const pngHtml = renderLogo('https://sfkm-blog.r2.liteyuki.org/snowykami-blog/icon.png')
    expect(pngHtml).toContain('/_next/image?url=https%3A%2F%2Fsfkm-blog.r2.liteyuki.org%2Fsnowykami-blog%2Ficon.png')
    expect(pngHtml).toContain('w=48')

    const icoHtml = renderLogo('https://sfkm-blog.r2.liteyuki.org/snowykami-blog/favicon.ico')
    expect(icoHtml).toContain('src="https://sfkm-blog.r2.liteyuki.org/snowykami-blog/favicon.ico"')
    expect(icoHtml).not.toContain('/_next/image')

    const svgHtml = renderLogo('https://sfkm-blog.r2.liteyuki.org/snowykami-blog/logo.svg')
    expect(svgHtml).toContain('src="https://sfkm-blog.r2.liteyuki.org/snowykami-blog/logo.svg"')
    expect(svgHtml).not.toContain('/_next/image')
  })

  it('preload 或 priority 图片输出 loading="eager" 与 fetchpriority="high"，普通图片输出 loading="lazy"', () => {
    const renderImg = (props: Record<string, unknown>) => renderToStaticMarkup(
      React.createElement(ImageOptimizeProvider, {
        hosts: ['sfkm-blog.r2.liteyuki.org'],
        children: React.createElement(SafeImage, {
          src: 'https://sfkm-blog.r2.liteyuki.org/snowykami-blog/cover.png',
          alt: '',
          fill: true,
          sizes: '(max-width: 640px) 260px, (max-width: 767px) 360px, 280px',
          ...props,
        }),
      }),
    )

    const preloadHtml = renderImg({ preload: true })
    expect(preloadHtml).toContain('loading="eager"')
    expect(preloadHtml).toMatch(/fetchpriority="high"/i)
    expect(preloadHtml).not.toContain('loading="lazy"')

    const priorityHtml = renderImg({ priority: true })
    expect(priorityHtml).toContain('loading="eager"')
    expect(priorityHtml).toMatch(/fetchpriority="high"/i)
    expect(priorityHtml).not.toContain('loading="lazy"')

    const defaultHtml = renderImg({})
    expect(defaultHtml).toContain('loading="lazy"')
    expect(defaultHtml).not.toMatch(/fetchpriority="high"/i)
  })
})
