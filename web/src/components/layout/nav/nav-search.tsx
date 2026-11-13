'use client'

import { SearchIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// 搜索弹窗（cmdk、Dialog、结果渲染）第一次打开时才加载：顶栏每页都在，首屏只需要触发按钮
const NavSearchDialog = dynamic(() => import('./nav-search-dialog').then(m => m.NavSearchDialog), { ssr: false })

/** 焦点在输入框、文本域或可编辑区域里（不抢这些地方的 Ctrl/⌘ + K） */
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement))
    return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * 前台全站聚合搜索入口：顶栏的搜索按钮，支持 Ctrl/⌘ + K 快捷键唤起；弹窗本身按需加载（见 nav-search-dialog.tsx）
 */
export function NavSearch({ className, onNavigate }: { className?: string, onNavigate?: () => void }) {
  const t = useTranslations('Search')
  const [open, setOpen] = useState(false)
  // 打开过一次后保持挂载：关闭动画照常播放，再次打开不用重新加载
  const [everOpened, setEverOpened] = useState(false)
  const openSearch = () => {
    setEverOpened(true)
    setOpen(true)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || isEditableTarget(event.target))
        return
      event.preventDefault()
      setEverOpened(true)
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <button
        type="button"
        aria-label={t('search')}
        title={t('search')}
        className={cn('inline-flex items-center justify-center', className)}
        // 悬停 / 聚焦时先下载弹窗代码，点下去时通常已经就绪
        onPointerEnter={() => void import('./nav-search-dialog')}
        onFocus={() => void import('./nav-search-dialog')}
        onClick={openSearch}
      >
        <SearchIcon aria-hidden className="size-5" />
      </button>
      {everOpened && <NavSearchDialog open={open} setOpen={setOpen} onNavigate={onNavigate} />}
    </>
  )
}
