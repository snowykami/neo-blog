'use client'

import type { KeyboardEvent } from 'react'
import type { FriendColorKey } from '@/models/friend'
import { SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FRIEND_PALETTE_32, pickFriendColorFromSeed } from '@/models/friend'

export function FriendColorPicker({
  value,
  seedText,
  onChange,
}: {
  value: FriendColorKey
  seedText?: string
  onChange: (next: FriendColorKey) => void
}) {
  const t = useTranslations('Friends')
  const groupRef = useRef<HTMLDivElement | null>(null)

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let delta = 0
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      delta = 1
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      delta = -1
    if (delta === 0)
      return
    event.preventDefault()
    const nextIdx = (index + delta + FRIEND_PALETTE_32.length) % FRIEND_PALETTE_32.length
    const nextItem = FRIEND_PALETTE_32[nextIdx]
    onChange(nextItem.key)
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]')
    buttons?.[nextIdx]?.focus()
  }

  const activeIdx = Math.max(0, FRIEND_PALETTE_32.findIndex(item => item.key === value))

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{value}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => onChange(pickFriendColorFromSeed(seedText?.trim() || String(Date.now())))}
        >
          <SparklesIcon className="size-3.5" />
          {t('match_color')}
        </Button>
      </div>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={t('field_color')}
        className="grid min-w-0 grid-cols-6 justify-items-center gap-1 rounded-xl border bg-background p-2 min-[360px]:grid-cols-8 sm:grid-cols-16 sm:gap-1.5 sm:p-2.5"
      >
        {FRIEND_PALETTE_32.map((item, idx) => (
          <button
            key={item.key}
            type="button"
            role="radio"
            aria-checked={value === item.key}
            tabIndex={idx === activeIdx ? 0 : -1}
            title={item.key}
            onClick={() => onChange(item.key)}
            onKeyDown={e => handleKeyDown(e, idx)}
            className={cn(
              'size-6 shrink-0 rounded-md border-2 border-transparent transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              value === item.key && 'scale-110 border-foreground ring-2 ring-card',
            )}
            style={{ backgroundColor: item.hex }}
          />
        ))}
      </div>
    </div>
  )
}
