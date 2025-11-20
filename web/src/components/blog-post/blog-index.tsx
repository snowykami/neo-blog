'use client'

import React, { useEffect, useState } from 'react'
import { useHash } from 'react-use'

interface HeadingItem { id: string, text: string, level: number }

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/<[^>]+(>|$)/g, '')
    .replace(/[\s+~.()'"!:@,/\\]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function PostToc({
  html,
  maxLevel = 3,
  className = '',
}: {
  html: string
  maxLevel?: number
  className?: string
}) {
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [, setHash] = useHash()

  useEffect(() => {
    if (!html) {
      setHeadings([])
      return
    }

    // 在内存中解析 HTML，仅用于生成 TOC 数据，不修改页面 DOM
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const nodes = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[]

    const seen = new Set<string>()
    const items: HeadingItem[] = nodes.map((el) => {
      const text = (el.textContent || '').trim()
      const base = el.id || slugify(text || 'heading')
      let id = base
      let i = 1
      // 保证在 TOC 中唯一，同时尽量避免与页面已有 id 冲突
      while (seen.has(id) || document.getElementById(id)) {
        id = `${base}-${i++}`
      }
      seen.add(id)
      return { id, text, level: Number(el.tagName[1]) }
    })

    setHeadings(items)
  }, [html])

  function onClick(e: React.MouseEvent, id: string) {
    e.preventDefault()
    // 仅修改 hash，包含 # 前缀；页面负责监听 hashchange 并滚动
    setHash(`#${id}`)
  }

  if (!headings.length)
    return null

  return (
    <aside className={`hidden lg:block w-auto bg-background p-4 rounded-xl ${className}`}>
      <nav className="sticky top-24">
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {headings
            .filter(h => h.level <= maxLevel)
            .map(h => (
              <li key={h.id} style={{ marginLeft: `${(h.level - 1) * 12}px`, marginBottom: 6 }}>
                <a
                  href={`#${h.id}`}
                  onClick={e => onClick(e, h.id)}
                  style={{ color: '#666', textDecoration: 'none' }}
                >
                  {h.text}
                </a>
              </li>
            ))}
        </ul>
      </nav>
    </aside>
  )
}
// ...existing code...
