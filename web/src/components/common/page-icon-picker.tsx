'use client'

import type { PageKind } from '@/models/page'
import { ChevronDownIcon, CircleOffIcon, FileTextIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PAGE_ICON_ENTRIES, PAGE_ICON_MAP, PAGE_ICON_NONE, resolvePageNavIcon } from '@/lib/page-icons'
import { cn } from '@/lib/utils'

export { PAGE_ICON_ENTRIES, PAGE_ICON_NONE, resolvePageNavIcon } from '@/lib/page-icons'

export function PageIconPicker({
  value,
  kind = 'content',
  linkUrl = '',
  onChange,
}: {
  value: string
  kind?: PageKind
  linkUrl?: string
  onChange: (next: string) => void
}) {
  const t = useTranslations('Console.pages.meta')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const normalized = (value || '').trim().toLowerCase()
  const ResolvedPreview = resolvePageNavIcon({ icon: normalized, kind, linkUrl })
  const DefaultPreview = resolvePageNavIcon({ icon: '', kind, linkUrl }) ?? FileTextIcon

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q)
      return PAGE_ICON_ENTRIES
    return PAGE_ICON_ENTRIES.filter(item => item.key.includes(q) || item.keywords.toLowerCase().includes(q))
  }, [query])

  const selectValue = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  const triggerLabel = normalized === PAGE_ICON_NONE
    ? t('icon_none')
    : normalized && PAGE_ICON_MAP.has(normalized)
      ? normalized
      : t('icon_auto')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className="inline-flex items-center gap-2 truncate">
            {ResolvedPreview
              ? <ResolvedPreview className="size-4 shrink-0 text-foreground/80" />
              : <CircleOffIcon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="truncate text-sm">{triggerLabel}</span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="grid gap-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant={normalized === '' ? 'secondary' : 'outline'}
              size="sm"
              className="justify-start gap-2 text-xs"
              onClick={() => selectValue('')}
            >
              <DefaultPreview className="size-3.5 shrink-0" />
              <span className="truncate">{t('icon_auto')}</span>
            </Button>
            <Button
              type="button"
              variant={normalized === PAGE_ICON_NONE ? 'secondary' : 'outline'}
              size="sm"
              className="justify-start gap-2 text-xs"
              onClick={() => selectValue(PAGE_ICON_NONE)}
            >
              <CircleOffIcon className="size-3.5 shrink-0" />
              <span className="truncate">{t('icon_none')}</span>
            </Button>
          </div>

          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('icon_search_placeholder')}
            className="h-8 text-xs"
          />

          <div className="grid max-h-52 grid-cols-6 gap-1 overflow-y-auto pr-0.5">
            {filtered.map((entry) => {
              const IconComp = entry.icon
              const active = normalized === entry.key
              return (
                <button
                  key={entry.key}
                  type="button"
                  title={entry.key}
                  onClick={() => selectValue(entry.key)}
                  className={cn(
                    'flex size-10 items-center justify-center rounded-lg border border-transparent text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active && 'border-primary/40 bg-primary/10 text-primary',
                  )}
                >
                  <IconComp className="size-4.5" />
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="col-span-6 py-4 text-center text-xs text-muted-foreground">
                {t('icon_empty')}
              </p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
