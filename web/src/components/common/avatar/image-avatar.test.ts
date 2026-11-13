import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImageAvatar } from './image-avatar'

describe('image-avatar 服务端直出 <img>', () => {
  it('传入站内图片时，SSR 直接输出带 srcSet 与 sizes 的 <img>，并根据 eager 控制加载时机', () => {
    const lazyHtml = renderToStaticMarkup(
      React.createElement(ImageAvatar, {
        src: '/uploads/avatar.png',
        alt: 'Alice',
        fallback: 'A',
        sizes: '48px',
      }),
    )
    expect(lazyHtml).toContain('<img')
    expect(lazyHtml).toContain('data-slot="avatar-image"')
    expect(lazyHtml).toContain('srcSet="/_next/image?')
    expect(lazyHtml).toContain('sizes="48px"')
    expect(lazyHtml).toContain('loading="lazy"')

    const eagerHtml = renderToStaticMarkup(
      React.createElement(ImageAvatar, {
        src: '/uploads/avatar.png',
        alt: 'Alice',
        fallback: 'A',
        sizes: '80px',
        eager: true,
      }),
    )
    expect(eagerHtml).toContain('loading="eager"')
    expect(eagerHtml).toContain('sizes="80px"')
  })

  it('设置 fallbackDelayMs 时 SSR 不先渲染兜底文字；无图片时直接输出兜底内容', () => {
    const delayedHtml = renderToStaticMarkup(
      React.createElement(ImageAvatar, {
        src: '/uploads/avatar.png',
        alt: 'Alice',
        fallback: 'A',
        fallbackDelayMs: 600,
      }),
    )
    expect(delayedHtml).toContain('<img')
    expect(delayedHtml).not.toContain('data-slot="avatar-fallback"')

    const emptyHtml = renderToStaticMarkup(
      React.createElement(ImageAvatar, {
        src: '',
        alt: 'Alice',
        fallback: 'A',
        fallbackDelayMs: 600,
      }),
    )
    expect(emptyHtml).not.toContain('<img')
    expect(emptyHtml).toContain('data-slot="avatar-fallback"')
    expect(emptyHtml).toContain('>A<')

    const nullHtml = renderToStaticMarkup(
      React.createElement(ImageAvatar, {
        src: null,
        alt: 'Alice',
        fallback: 'A',
      }),
    )
    expect(nullHtml).not.toContain('<img')
    expect(nullHtml).toContain('data-slot="avatar-fallback"')
  })
})
