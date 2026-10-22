'use client'

import { SearchIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { mainPath } from '@/utils/common/route'

/**
 * 前台搜索入口：打开搜索框，回车或选择后跳转到首页 /?query=关键词
 * 支持 Ctrl/⌘ + K 快捷键打开
 */
export function NavSearch({ className, onNavigate }: { className?: string, onNavigate?: () => void }) {
  const t = useTranslations('Search')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  useHotkeys('mod+k', (event) => {
    event.preventDefault()
    setOpen(true)
  }, { enableOnFormTags: false })

  const keyword = query.trim()
  const submit = () => {
    if (!keyword)
      return
    setOpen(false)
    setQuery('')
    onNavigate?.()
    router.push(`${mainPath.home}?query=${encodeURIComponent(keyword)}`)
  }

  return (
    <>
      <button
        type="button"
        aria-label={t('search')}
        title={t('search')}
        className={cn('inline-flex items-center justify-center', className)}
        onClick={() => setOpen(true)}
      >
        <SearchIcon aria-hidden className="size-5" />
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title={t('search')} description={t('description')}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('placeholder')}
        />
        <CommandList>
          {keyword && (
            <CommandGroup>
              {/* 始终显示该项，不参与 cmdk 的内置过滤 */}
              <CommandItem forceMount value="search-posts" onSelect={submit}>
                <SearchIcon />
                <span className="truncate">{t('search_posts_for', { query: keyword })}</span>
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}
