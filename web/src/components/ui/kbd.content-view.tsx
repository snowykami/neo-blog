'use client'

import type { ShortcutContentProps } from './kbd.content'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { splitKeys } from './kbd.content'

/** 快捷键说明：按键组合 + 说明文字 */
export default function ShortcutContent({ keys, description }: ShortcutContentProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <KbdGroup>
        {splitKeys(keys).map((key, index) => (
          <span key={index} className="inline-flex items-center gap-1">
            {index > 0 && <span className="text-muted-foreground">+</span>}
            <Kbd className="h-6 min-w-6 border px-1.5">{key}</Kbd>
          </span>
        ))}
      </KbdGroup>
      {description && <span className="text-foreground/80">{description}</span>}
    </div>
  )
}
